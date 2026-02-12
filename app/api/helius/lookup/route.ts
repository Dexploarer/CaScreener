import { getTransaction, getAsset, getEnhancedTransactions } from "@/lib/helius/client";
import { getAddressEnrichment, getWalletTransactions } from "@/lib/allium/client";
import { buildWalletAnalytics } from "@/lib/helius/analytics";
import { computeTokenTrustScore } from "@/lib/helius/trust-score";
import { isValidLookupId, isValidSolanaAddress } from "@/lib/helius/validation";
import { findSolanaTokensByTicker, isLikelyTickerQuery, mergeImageUris } from "@/lib/token-discovery/dexscreener";
import { getTokenTrades } from "@/lib/market-data/pumpportal";
import { processWatchAlertsForTokenInConvex, trackTokenMetaInConvex } from "@/lib/meme-meta/convex-rag";
import type { TransactionLookupResult } from "@/lib/helius/types";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function collectAssetImageUris(asset: Awaited<ReturnType<typeof getAsset>> | null): string[] {
  if (!asset || !isRecord(asset)) return [];
  const root = asset as Record<string, unknown>;
  const content = isRecord(root.content) ? root.content : null;
  const files = Array.isArray(content?.files) ? content.files : [];
  const fileImageUris = files.flatMap((file) => {
    if (!isRecord(file)) return [];
    return [
      asNonEmptyString(file.uri),
      asNonEmptyString(file.cdn_uri),
      asNonEmptyString(file.cdnUri),
      asNonEmptyString(file.preview_uri),
      asNonEmptyString(file.previewUri),
    ];
  });
  const metadata = isRecord(content?.metadata) ? content.metadata : null;
  const contentLinks = isRecord(content?.links) ? content.links : null;
  const rootMetadata = isRecord(root.metadata) ? root.metadata : null;
  const rootLinks = isRecord(root.links) ? root.links : null;
  return mergeImageUris(
    fileImageUris,
    [
      asNonEmptyString(metadata?.image),
      asNonEmptyString(contentLinks?.image),
      asNonEmptyString(rootMetadata?.image),
      asNonEmptyString(rootLinks?.image),
    ]
  );
}

export async function POST(req: Request): Promise<Response> {
  const { rateLimit: rateLimitFn, getClientIdentifier } = await import("@/lib/rate-limit");
  const limiter = rateLimitFn(getClientIdentifier(req), "helius-lookup");
  if (!limiter.ok) {
    return Response.json(
      { error: "Too many requests", retryAfter: Math.ceil(limiter.resetIn / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limiter.resetIn / 1000)) } }
    );
  }

  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "HELIUS_API_KEY is not set" },
      { status: 503 }
    );
  }

  let body: { type?: string; id?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const type = body.type?.toLowerCase();
  const id = body.id?.trim();
  if (!id) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  const isTokenQuery =
    type === "token" && (isValidSolanaAddress(id) || isLikelyTickerQuery(id));
  if (type === "token" && !isTokenQuery) {
    return Response.json(
      {
        error:
          "Invalid token query (use a Solana mint address or ticker, e.g. BONK)",
      },
      { status: 400 }
    );
  }
  if (type !== "token" && !isValidLookupId(id)) {
    return Response.json(
      {
        error:
          "Invalid id (use a Solana address, transaction signature, or mint/asset id)",
      },
      { status: 400 }
    );
  }

  switch (type) {
    case "wallet": {
      try {
        const analytics = await buildWalletAnalytics(apiKey, id);
        return Response.json({ resultType: "wallet" as const, ...analytics });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return Response.json(
          { error: "Helius request failed", details: message },
          { status: 502 }
        );
      }
    }

    case "transaction": {
      try {
        const [tx, enhancedList] = await Promise.all([
          getTransaction(apiKey, id),
          getEnhancedTransactions(apiKey, [id]).catch(() => []),
        ]);
        if (!tx) {
          return Response.json({ error: "Transaction not found" }, { status: 404 });
        }
        const enhanced = enhancedList?.[0];
        const result: TransactionLookupResult = {
          resultType: "transaction",
          signature: tx.signature,
          slot: tx.slot,
          blockTime: tx.blockTime,
          fee: tx.fee,
          feePayer: tx.feePayer,
          err: tx.err,
          ...(enhanced && {
            description: enhanced.description,
            type: enhanced.type,
            source: enhanced.source,
          }),
        };
        if (tx.feePayer) {
          const [alliumSummary, alliumTx] = await Promise.all([
            getAddressEnrichment(tx.feePayer).catch(() => null),
            getWalletTransactions("solana", tx.feePayer, { transactionHash: id, limit: 1 }).catch(() => null),
          ]);
          const txLabels = alliumTx?.items?.[0]?.labels ?? [];
          const summaryLabels = alliumSummary?.labels ?? [];
          const mergedLabels = [...summaryLabels, ...txLabels].filter((v, i, a) => a.indexOf(v) === i);
          if (alliumSummary || mergedLabels.length > 0) {
            result.alliumEnrichment = {
              ...(alliumSummary && {
                totalTxCount: alliumSummary.totalTxCount,
                firstSeen: alliumSummary.firstSeen,
                lastActive: alliumSummary.lastActive,
                chains: alliumSummary.chains,
                stats: alliumSummary.stats,
              }),
              ...(mergedLabels.length > 0 && { labels: mergedLabels }),
            };
          }
        }
        return Response.json(result);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return Response.json(
          { error: "Helius request failed", details: message },
          { status: 502 }
        );
      }
    }

    case "token": {
      try {
        const byMint = isValidSolanaAddress(id);
        const asset = byMint ? await getAsset(apiKey, id).catch(() => null) : null;
        const meta = asset?.content?.metadata;
        const assetImageUris = collectAssetImageUris(asset);
        const discovery = await findSolanaTokensByTicker({
          query: id,
          canonicalMint: byMint ? id : undefined,
          fallbackSymbol: meta?.symbol ?? (byMint ? undefined : id),
        });

        const canonical = byMint
          ? discovery.matches.find((m) => m.isExactMintMatch)
          : discovery.matches[0];
        const matchesWithImages = discovery.matches.map((match) => {
          if (
            !byMint ||
            match.mint.toLowerCase() !== id.toLowerCase() ||
            assetImageUris.length === 0
          ) {
            return match;
          }
          const mergedMatchImages = mergeImageUris(
            match.imageUris,
            match.imageUri ? [match.imageUri] : undefined,
            assetImageUris
          );
          return {
            ...match,
            imageUri: mergedMatchImages[0],
            imageUris: mergedMatchImages.length > 0 ? mergedMatchImages : undefined,
          };
        });
        const canonicalWithImages = byMint
          ? matchesWithImages.find((m) => m.isExactMintMatch) ?? canonical
          : matchesWithImages[0] ?? canonical;
        const pumpMint = (byMint ? id : canonicalWithImages?.mint)?.trim();
        const shouldProbePumpTrades =
          !!pumpMint &&
          (
            pumpMint.toLowerCase().endsWith("pump") ||
            matchesWithImages.length === 0 ||
            !meta?.symbol ||
            !meta?.name
          );
        const pumpTrades =
          shouldProbePumpTrades && pumpMint
            ? await getTokenTrades(pumpMint).catch(() => [])
            : [];
        const latestPumpTrade = pumpTrades[0];
        const pumpImageUris = mergeImageUris(
          pumpTrades.map((trade) => trade.uri)
        );

        if (byMint && !asset && discovery.matches.length === 0 && pumpTrades.length === 0) {
          return Response.json({ error: "Token not found" }, { status: 404 });
        }

        const mergedImageUris = mergeImageUris(
          assetImageUris,
          pumpImageUris,
          canonicalWithImages?.imageUris,
          canonicalWithImages?.imageUri ? [canonicalWithImages.imageUri] : undefined,
          ...matchesWithImages.map((m) =>
            m.imageUris ?? (m.imageUri ? [m.imageUri] : [])
          )
        );
        const imageUri = mergedImageUris[0];

        const payload = {
          resultType: "token" as const,
          id: byMint ? id : canonicalWithImages?.mint ?? id.toUpperCase(),
          name: meta?.name ?? canonicalWithImages?.name ?? latestPumpTrade?.name,
          symbol:
            meta?.symbol ??
            canonicalWithImages?.symbol ??
            latestPumpTrade?.symbol ??
            discovery.ticker,
          decimals: meta?.decimals,
          imageUri,
          imageUris: mergedImageUris.length > 0 ? mergedImageUris : undefined,
          lookupMode: discovery.mode,
          searchedTicker: discovery.ticker || undefined,
          canonicalMint: byMint ? id : canonicalWithImages?.mint,
          pumpPortal:
            pumpTrades.length > 0
              ? {
                  mint: pumpMint ?? id,
                  capturedAt: new Date().toISOString(),
                  recentTradeCount: pumpTrades.length,
                  buyCount: pumpTrades.filter((trade) => trade.txType === "buy").length,
                  sellCount: pumpTrades.filter((trade) => trade.txType === "sell").length,
                  createCount: pumpTrades.filter((trade) => trade.txType === "create").length,
                  totalSolVolume: pumpTrades.reduce(
                    (sum, trade) => sum + (trade.solAmount ?? 0),
                    0
                  ),
                  latestMarketCapSol:
                    latestPumpTrade?.marketCapSol ?? latestPumpTrade?.solAmount,
                  recentTrades: pumpTrades.slice(0, 16).map((trade) => ({
                    signature: trade.signature,
                    txType: trade.txType,
                    solAmount: trade.solAmount,
                    tokenAmount: trade.tokenAmount,
                    marketCapSol: trade.marketCapSol,
                    timestamp: trade.timestamp,
                    traderPublicKey: trade.traderPublicKey,
                    uri: trade.uri,
                    name: trade.name,
                    symbol: trade.symbol,
                  })),
                }
              : undefined,
          sameTickerTokens: matchesWithImages,
          sameTickerCount: matchesWithImages.length,
          sameTickerImageCount: mergedImageUris.length,
          suspiciousTickerCount: matchesWithImages.filter(
            (m) => !m.isExactMintMatch && (m.risk === "high" || m.risk === "medium")
          ).length,
        };
        const trustScore = computeTokenTrustScore(payload);
        const payloadWithTrust = {
          ...payload,
          trustScore,
        };

        // Non-blocking background calls: analytics should never delay token lookup responses.
        void trackTokenMetaInConvex(payloadWithTrust, {
          source: "helius-lookup",
        }).catch((trackingError) => {
          console.warn("Convex token-meta tracking failed:", trackingError);
        });
        void processWatchAlertsForTokenInConvex(payloadWithTrust).catch(
          (alertError) => {
            console.warn("Convex watchlist alert processing failed:", alertError);
          }
        );

        return Response.json(payloadWithTrust);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return Response.json(
          { error: "Helius request failed", details: message },
          { status: 502 }
        );
      }
    }

    case "nft": {
      try {
        const asset = await getAsset(apiKey, id);
        if (!asset) {
          return Response.json({ error: "Asset not found" }, { status: 404 });
        }
        const meta = asset.content?.metadata;
        const imageUri = asset.content?.files?.[0]?.uri;
        return Response.json({
          resultType: "nft" as const,
          id: asset.id,
          name: meta?.name,
          symbol: meta?.symbol,
          imageUri,
          interface: asset.interface,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return Response.json(
          { error: "Helius request failed", details: message },
          { status: 502 }
        );
      }
    }

    default:
      return Response.json(
        { error: "Invalid type. Use wallet, transaction, token, or nft" },
        { status: 400 }
      );
  }
}
