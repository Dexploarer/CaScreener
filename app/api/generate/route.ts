import { streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { buildWalletAnalytics } from "@/lib/helius/analytics";
import type { WalletAnalyticsPayload } from "@/lib/helius/analytics";
import {
  getTrendingMarkets,
  searchMarkets,
  getDiverseMarkets,
  extractPolymarketKeywords,
  serializeMarketsForLLM,
} from "@/lib/predictions/polymarket";
import { getTrendingMarkets as getManifoldTrending, searchMarkets as searchManifold } from "@/lib/predictions/manifold";
import { findArbitrageOpportunities } from "@/lib/predictions/arbitrage";
import type { PredictionMarket, ArbitrageOpportunity } from "@/lib/predictions/types";
import { generateAlphaReport, serializeAlphaForLLM } from "@/lib/alpha/cross-signal";
import type { AlphaReport } from "@/lib/alpha/cross-signal";
import { buildWhaleProfile, serializeWhaleForLLM } from "@/lib/alpha/whale-intel";
import type { WhaleProfile } from "@/lib/alpha/whale-intel";
import { generateNarrativeReport, serializeNarrativeForLLM } from "@/lib/alpha/narrative";
import type { NarrativeReport } from "@/lib/alpha/narrative";
import { deduplicateById, flattenDiverseMarkets } from "@/lib/alpha/shared";
import {
  getTopCoins,
  getTopMovers,
  getGlobalData,
  getTrending,
  getCoinsByIds,
  getCoinDetail,
  extractCoinIds,
  resolveCoinId,
  downsample,
  formatUsd,
  formatPct,
  formatCompact,
  type CoinMarketData,
  type GlobalData,
  type TrendingCoinItem,
  type CoinDetail,
} from "@/lib/market-data/coingecko";
import {
  getPumpSnapshot,
  serializePumpForLLM,
  type PumpSnapshot,
} from "@/lib/market-data/pumpportal";
import { buildPumpVideoPromptTemplate } from "@/lib/media/pump-remotion";
import type { TokenLookupResult } from "@/lib/helius/types";
import {
  buildSharePackOgImageUrl,
  buildTokenSharePack,
} from "@/lib/helius/share-pack";
import { LAMPORTS_PER_SOL } from "@/lib/helius/client";
import { computeTokenTrustScore } from "@/lib/helius/trust-score";
import {
  classifyQuery,
  extractSolanaAddress,
} from "@/lib/query-classifier";
import {
  enqueueTokenIntelHydrationInConvex,
  getTokenIntelHydrationRunInConvex,
  getLatestCompletedTokenIntelBySymbolInConvex,
  isConvexTrackingEnabled,
  type TokenIntelHydrationResult,
} from "@/lib/meme-meta/convex-rag";

export const maxDuration = 60;

const SPEC_STREAM_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

const openrouter = createOpenAICompatible({
  name: "openrouter",
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL?.trim() || "openrouter/aurora-alpha";
const TOKEN_INTEL_WORKFLOW_POLL_MS = 1500;

// ── JSON escape helper ──────────────────────────────────────────
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "")
    .replace(/\t/g, " ");
}

// ── Stream a pre-built JSONL spec with delay ────────────────────
function streamSpec(
  spec: string,
  status = 200,
  headers: HeadersInit = {}
): Response {
  const encoder = new TextEncoder();
  const lines = spec.split("\n").filter(Boolean);
  const stream = new ReadableStream({
    async start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + "\n"));
        await new Promise((r) => setTimeout(r, 25));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: {
      ...SPEC_STREAM_HEADERS,
      ...headers,
    },
  });
}

function buildStatusSpec(title: string, description: string): string {
  return [
    '{"op":"add","path":"/root","value":"status-card"}',
    `{"op":"add","path":"/elements/status-card","value":{"type":"Card","props":{"title":"${esc(title)}","description":"${esc(description)}"},"children":["status-note"]}}`,
    '{"op":"add","path":"/elements/status-note","value":{"type":"Text","props":{"content":"Try again in a moment."},"children":[]}}',
  ].join("\n");
}

function streamStatusSpec(
  title: string,
  description: string,
  status = 200,
  headers: HeadersInit = {}
): Response {
  return streamSpec(buildStatusSpec(title, description), status, headers);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isTokenLookupResult(value: unknown): value is TokenLookupResult {
  return isRecord(value) && value.resultType === "token" && typeof value.id === "string";
}

function extractTickerHint(prompt: string): string | null {
  const explicit = prompt.match(
    /\b(?:ticker|symbol|token)\s*(?:is|=|:)?\s*\$?([a-zA-Z0-9]{2,12})\b/i
  );
  if (explicit?.[1]) return explicit[1].toUpperCase();

  const dollar = prompt.match(/\$([A-Za-z][A-Za-z0-9]{1,11})\b/);
  if (dollar?.[1]) return dollar[1].toUpperCase();

  const single = prompt.trim();
  if (/^[A-Za-z][A-Za-z0-9]{2,12}$/.test(single)) {
    return single.toUpperCase();
  }
  return null;
}

function extractTokenLookupHint(prompt: string): string | null {
  const mint = extractSolanaAddress(prompt);
  if (mint) return mint;
  return extractTickerHint(prompt);
}

const SOLANA_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function buildFallbackTokenLookup(
  lookupId: string,
  prompt: string
): TokenLookupResult {
  const normalized = lookupId.trim();
  const mintLike = SOLANA_MINT_RE.test(normalized);
  const tickerHint = extractTickerHint(prompt) ?? extractTickerHint(lookupId);
  const symbol = (tickerHint ?? (mintLike ? normalized.slice(0, 6) : normalized))
    .replace(/^\$/, "")
    .toUpperCase();
  const id = mintLike ? normalized : symbol || normalized.toUpperCase();

  return {
    resultType: "token",
    id,
    name: symbol || "TOKEN",
    symbol: symbol || "TOKEN",
    lookupMode: mintLike ? "mint" : "ticker",
    searchedTicker: !mintLike ? symbol : undefined,
    canonicalMint: mintLike ? normalized : undefined,
    sameTickerTokens: [],
    sameTickerCount: 0,
    sameTickerImageCount: 0,
    suspiciousTickerCount: 0,
  };
}

async function fetchTokenLookup(req: Request, id: string): Promise<TokenLookupResult | null> {
  const origin = new URL(req.url).origin;
  const res = await fetch(`${origin}/api/helius/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "token", id }),
    cache: "no-store",
  }).catch(() => null);

  if (!res || !res.ok) return null;
  const payload = await res.json().catch(() => null);
  return isTokenLookupResult(payload) ? payload : null;
}

type TokenSharePackContext = {
  summary: string;
  threadText: string;
  xIntentUrl: string;
  farcasterIntentUrl: string;
  ogImageUrl: string;
  hypePromptTemplate: string;
  hypeHook: string;
  timelineJson: string;
  videoRenderEndpoint: string;
};

function buildTokenSharePackContext(
  req: Request,
  token: TokenLookupResult
): TokenSharePackContext {
  const trust = token.trustScore ?? computeTokenTrustScore(token);
  const sharePack = buildTokenSharePack(token, trust);
  const origin = new URL(req.url).origin;
  const ogImageUrl = buildSharePackOgImageUrl(
    origin,
    token,
    trust,
    sharePack.summary
  );
  const threadText = sharePack.thread
    .map((line, idx) => `${idx + 1}. ${line}`)
    .join("\n");

  return {
    summary: sharePack.summary,
    threadText,
    xIntentUrl: sharePack.xIntentUrl,
    farcasterIntentUrl: sharePack.farcasterIntentUrl,
    ogImageUrl,
    hypePromptTemplate: sharePack.hypeVideo.promptTemplate,
    hypeHook: sharePack.hypeVideo.hook,
    timelineJson: JSON.stringify(sharePack.hypeVideo.timeline),
    videoRenderEndpoint: `${origin}/api/share/video`,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchConvexTokenIntelHydration(
  prompt: string,
  token: TokenLookupResult,
  isSuper = false
): Promise<TokenIntelHydrationResult | null> {
  if (!isConvexTrackingEnabled()) return null;

  const query =
    prompt.trim() ||
    `meme token clone intel for ${token.symbol ?? "UNKNOWN"} ${token.id}`;
  const symbol = token.symbol?.trim().toUpperCase();
  const mint = token.id?.trim();
  let cached: TokenIntelHydrationResult | null = null;

  if (!query) return null;

  try {
    if (symbol && !isSuper) {
      const latest = await getLatestCompletedTokenIntelBySymbolInConvex(
        symbol
      ).catch(() => null);
      if (latest?.result) {
        cached = latest.result;
      }
    }

    const job = await enqueueTokenIntelHydrationInConvex({
      query,
      symbol,
      mint,
      requestedBy: "api-generate",
    });

    const pollMs = isSuper ? 6000 : TOKEN_INTEL_WORKFLOW_POLL_MS;
    const deadline = Date.now() + pollMs;
    while (Date.now() < deadline) {
      const run = await getTokenIntelHydrationRunInConvex(job.jobId).catch(
        () => null
      );
      if (!run) break;
      if (run.status === "completed" && run.result) {
        return run.result;
      }
      if (run.status === "failed") {
        return cached ?? run.result ?? null;
      }
      await wait(180);
    }
  } catch (error) {
    console.warn("Convex token intel hydration failed:", error);
  }

  return cached;
}

// ══════════════════════════════════════════════════════════════════
// SPEC BUILDER: Wallet Dashboard (Helius + Allium real data)
// ══════════════════════════════════════════════════════════════════
function buildWalletSpec(data: WalletAnalyticsPayload): string {
  const addr = data.address;
  const short = `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  const solBal = data.solBalance.toFixed(4);

  const topTokens = data.tokenAccounts
    .filter((t) => t.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  const recentTxs = data.transactions.slice(0, 8);

  const lines: string[] = [];
  const push = (line: string) => lines.push(line);

  // ── Root structure ──
  push(`{"op":"add","path":"/root","value":"card-main"}`);

  const mainChildren: string[] = [
    "badges-row",
    "metrics-row",
  ];

  // ── Badges for labels ──
  const badgeKeys: string[] = [];
  const allLabels = data.alliumEnrichment?.labels ?? [];
  if (allLabels.length > 0) {
    allLabels.slice(0, 5).forEach((label, i) => {
      const key = `badge-${i}`;
      badgeKeys.push(key);
      const variant =
        label.toLowerCase().includes("whale")
          ? "warning"
          : label.toLowerCase().includes("bot") ||
            label.toLowerCase().includes("mev")
            ? "danger"
            : label.toLowerCase().includes("defi") ||
              label.toLowerCase().includes("active")
              ? "success"
              : "info";
      push(
        `{"op":"add","path":"/elements/${key}","value":{"type":"Badge","props":{"label":"${esc(label)}","variant":"${variant}"},"children":[]}}`
      );
    });
  }
  // Always add an "Active" badge based on data
  if (badgeKeys.length === 0) {
    badgeKeys.push("badge-active");
    push(
      `{"op":"add","path":"/elements/badge-active","value":{"type":"Badge","props":{"label":"Solana","variant":"info"},"children":[]}}`
    );
  }
  push(
    `{"op":"add","path":"/elements/badges-row","value":{"type":"Stack","props":{"gap":"sm","direction":"horizontal"},"children":${JSON.stringify(badgeKeys)}}}`
  );

  // ── Metrics row ──
  const metricKeys: string[] = [];
  const addMetric = (
    key: string,
    label: string,
    value: string,
    change?: string
  ) => {
    metricKeys.push(key);
    const changeStr = change ? `,"change":"${esc(change)}"` : "";
    push(
      `{"op":"add","path":"/elements/${key}","value":{"type":"Metric","props":{"label":"${esc(label)}","value":"${esc(value)}","format":"number"${changeStr}},"children":[]}}`
    );
  };

  addMetric("m-sol", "SOL Balance", `${solBal} SOL`);
  addMetric("m-tokens", "Token Holdings", String(data.tokenCount));
  addMetric("m-nfts", "NFTs", String(data.nftCount));

  if (data.alliumEnrichment?.totalTxCount) {
    addMetric(
      "m-total-tx",
      "Lifetime Txs",
      data.alliumEnrichment.totalTxCount.toLocaleString()
    );
  } else {
    addMetric("m-txs", "Recent Txs", String(data.transactionCount));
  }

  if (data.alliumEnrichment?.firstSeen) {
    const d = new Date(data.alliumEnrichment.firstSeen);
    const now = new Date();
    const months = Math.floor(
      (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 30)
    );
    const ageStr =
      months > 24
        ? `${Math.floor(months / 12)}y ${months % 12}m`
        : months > 0
          ? `${months}m`
          : "<1m";
    addMetric("m-age", "Wallet Age", ageStr);
  }

  if (data.alliumEnrichment?.chains && data.alliumEnrichment.chains.length > 1) {
    addMetric(
      "m-chains",
      "Active Chains",
      String(data.alliumEnrichment.chains.length)
    );
  }

  push(
    `{"op":"add","path":"/elements/metrics-row","value":{"type":"Stack","props":{"gap":"md","direction":"horizontal"},"children":${JSON.stringify(metricKeys)}}}`
  );

  // ── Token Holdings Table ──
  if (topTokens.length > 0) {
    mainChildren.push("div-tokens", "heading-tokens", "tokens-table");
    push(
      `{"op":"add","path":"/elements/div-tokens","value":{"type":"Divider","props":{"label":"Token Holdings"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/heading-tokens","value":{"type":"Heading","props":{"text":"Top ${topTokens.length} Tokens by Balance","size":"sm"},"children":[]}}`
    );

    const tokenCols = ["Token", "Balance", "Mint"];
    const tokenRows = topTokens.map((t) => {
      const symbol = t.symbol || t.mint.slice(0, 6) + "...";
      const dec = t.decimals ?? 0;
      const amt =
        dec > 0
          ? (t.amount / Math.pow(10, dec)).toLocaleString(undefined, {
            maximumFractionDigits: 4,
          })
          : t.amount.toLocaleString();
      const mintShort = `${t.mint.slice(0, 4)}...${t.mint.slice(-4)}`;
      return [symbol, amt, mintShort];
    });

    push(
      `{"op":"add","path":"/elements/tokens-table","value":{"type":"Table","props":{"columns":${JSON.stringify(tokenCols)},"rows":${JSON.stringify(tokenRows)}},"children":[]}}`
    );

    // TokenRow for top 5 holdings
    topTokens.slice(0, 5).forEach((t, i) => {
      const trKey = `wallet-token-${i}`;
      mainChildren.push(trKey);
      const symbol = t.symbol || t.mint.slice(0, 6);
      const dec = t.decimals ?? 0;
      const amt = dec > 0
        ? (t.amount / Math.pow(10, dec)).toLocaleString(undefined, { maximumFractionDigits: 4 })
        : t.amount.toLocaleString();
      push(
        `{"op":"add","path":"/elements/${trKey}","value":{"type":"TokenRow","props":{"name":"${esc(symbol)}","symbol":"${esc(symbol)}","imageUrl":null,"price":"${esc(amt)}","change":null,"sparklineData":null,"rank":${i + 1}},"children":[]}}`
      );
    });

    // Portfolio allocation bars (top 5)
    if (topTokens.length >= 2) {
      mainChildren.push("portfolio-bars");
      const totalAmount = topTokens.reduce((s, t) => {
        const dec = t.decimals ?? 0;
        return s + (dec > 0 ? t.amount / Math.pow(10, dec) : t.amount);
      }, 0);
      const barColors = ["emerald", "cyan", "amber", "violet", "red"];
      const bars = topTokens.slice(0, 5).map((t, i) => {
        const symbol = t.symbol || t.mint.slice(0, 6);
        const dec = t.decimals ?? 0;
        const amt = dec > 0 ? t.amount / Math.pow(10, dec) : t.amount;
        const pct = totalAmount > 0 ? Math.round((amt / totalAmount) * 100) : 0;
        return `{"label":"${esc(symbol)}","value":${pct},"color":"${barColors[i % barColors.length]}"}`;
      });
      push(
        `{"op":"add","path":"/elements/portfolio-bars","value":{"type":"BarChart","props":{"bars":[${bars.join(",")}]},"children":[]}}`
      );
    }
  }

  // ── Transaction History Table ──
  if (recentTxs.length > 0) {
    mainChildren.push("div-txs", "heading-txs", "txs-table");
    push(
      `{"op":"add","path":"/elements/div-txs","value":{"type":"Divider","props":{"label":"Recent Activity"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/heading-txs","value":{"type":"Heading","props":{"text":"Last ${recentTxs.length} Transactions","size":"sm"},"children":[]}}`
    );

    const txCols = ["Type", "Description", "Time", "Sig"];
    const txRows = recentTxs.map((tx) => {
      const type = tx.type || "UNKNOWN";
      const desc = tx.description
        ? tx.description.length > 50
          ? tx.description.slice(0, 47) + "..."
          : tx.description
        : "-";
      const time = tx.blockTime
        ? new Date(tx.blockTime * 1000).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
        : "-";
      const sig = `${tx.signature.slice(0, 6)}...${tx.signature.slice(-4)}`;
      return [type, desc, time, sig];
    });

    push(
      `{"op":"add","path":"/elements/txs-table","value":{"type":"Table","props":{"columns":${JSON.stringify(txCols)},"rows":${JSON.stringify(txRows.map((r) => r.map((c) => esc(c))))}},"children":[]}}`
    );
  }

  // ── NFT summary ──
  if (data.nftCount > 0 && data.nfts.length > 0) {
    mainChildren.push("div-nfts", "nfts-text");
    push(
      `{"op":"add","path":"/elements/div-nfts","value":{"type":"Divider","props":{"label":"NFTs"},"children":[]}}`
    );
    const nftNames = data.nfts
      .slice(0, 8)
      .map((n) => n.name || "Unnamed NFT")
      .join(", ");
    push(
      `{"op":"add","path":"/elements/nfts-text","value":{"type":"Text","props":{"content":"${esc(`${data.nftCount} NFTs held. Including: ${nftNames}${data.nftCount > 8 ? ` and ${data.nftCount - 8} more...` : ""}`)}"},"children":[]}}`
    );
  }

  // ── Native Transfers (SOL) ──
  if (data.nativeTransfers.length > 0) {
    mainChildren.push("div-native-transfers", "native-transfers-table");
    push(
      `{"op":"add","path":"/elements/div-native-transfers","value":{"type":"Divider","props":{"label":"SOL Transfers"},"children":[]}}`
    );
    const ntCols = ["From", "To", "Amount", "Time"];
    const ntRows = data.nativeTransfers.slice(0, 8).map((nt) => {
      const from =
        nt.fromUserAccount === addr
          ? "Self"
          : `${nt.fromUserAccount.slice(0, 4)}...${nt.fromUserAccount.slice(-4)}`;
      const to =
        nt.toUserAccount === addr
          ? "Self"
          : `${nt.toUserAccount.slice(0, 4)}...${nt.toUserAccount.slice(-4)}`;
      const amt = (nt.amount / LAMPORTS_PER_SOL).toFixed(4) + " SOL";
      const time = new Date(nt.timestamp).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      return [from, to, amt, time];
    });
    push(
      `{"op":"add","path":"/elements/native-transfers-table","value":{"type":"Table","props":{"columns":${JSON.stringify(
        ntCols
      )},"rows":${JSON.stringify(
        ntRows.map((r) => r.map((c) => esc(c)))
      )}},"children":[]}}`
    );
  }

  // ── Token Transfers ──
  if (data.tokenTransfers.length > 0) {
    mainChildren.push("div-token-transfers", "token-transfers-table");
    push(
      `{"op":"add","path":"/elements/div-token-transfers","value":{"type":"Divider","props":{"label":"Token Transfers"},"children":[]}}`
    );
    const ttCols = ["From", "To", "Amount", "Mint", "Time"];
    const ttRows = data.tokenTransfers.slice(0, 8).map((tt) => {
      const from =
        tt.fromUserAccount === addr
          ? "Self"
          : `${tt.fromUserAccount.slice(0, 4)}...${tt.fromUserAccount.slice(-4)}`;
      const to =
        tt.toUserAccount === addr
          ? "Self"
          : `${tt.toUserAccount.slice(0, 4)}...${tt.toUserAccount.slice(-4)}`;
      const amt = tt.amount.toLocaleString();
      const mint = `${tt.mint.slice(0, 4)}...${tt.mint.slice(-4)}`;
      const time = new Date(tt.timestamp).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      return [from, to, amt, mint, time];
    });
    push(
      `{"op":"add","path":"/elements/token-transfers-table","value":{"type":"Table","props":{"columns":${JSON.stringify(
        ttCols
      )},"rows":${JSON.stringify(
        ttRows.map((r) => r.map((c) => esc(c)))
      )}},"children":[]}}`
    );
  }

  // ── Action buttons ──
  mainChildren.push("btns-row");
  push(
    `{"op":"add","path":"/elements/btn-solscan","value":{"type":"Button","props":{"label":"View on Solscan","action":"navigate","params":{"url":"${esc(`https://solscan.io/account/${addr}`)}"}},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/btn-birdeye","value":{"type":"Button","props":{"label":"View on Birdeye","action":"navigate","params":{"url":"${esc(`https://birdeye.so/profile/${addr}?chain=solana`)}"}},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/btns-row","value":{"type":"Stack","props":{"gap":"sm","direction":"horizontal"},"children":["btn-solscan","btn-birdeye"]}}`
  );

  // ── Assemble ──
  push(
    `{"op":"add","path":"/elements/main-stack","value":{"type":"Stack","props":{"gap":"lg","direction":"vertical"},"children":${JSON.stringify(mainChildren)}}}`
  );
  push(
    `{"op":"add","path":"/elements/card-main","value":{"type":"Card","props":{"title":"Wallet: ${esc(short)}","description":"${esc(addr)}"},"children":["main-stack"]}}`
  );

  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════
// SPEC BUILDER: Token Intel Dashboard (mint/ticker anti-fake view)
// ══════════════════════════════════════════════════════════════════
function buildTokenIntelSpec(
  token: TokenLookupResult,
  prompt: string,
  convexIntel: TokenIntelHydrationResult | null = null,
  sharePack: TokenSharePackContext | null = null,
  coinDetail: CoinDetail | null = null
): string {
  const lines: string[] = [];
  const push = (line: string) => lines.push(line);

  const symbol = (token.symbol || "UNK").toUpperCase();
  const name = token.name || symbol;
  const mint = token.id;
  const shortMint = `${mint.slice(0, 4)}...${mint.slice(-4)}`;
  const trust = token.trustScore;
  const trustScoreValue = trust?.score ?? 0;
  const trustGrade = trust?.grade ?? "N/A";
  const sameTickerCount = token.sameTickerCount ?? token.sameTickerTokens?.length ?? 0;
  const suspiciousCount = token.suspiciousTickerCount ?? 0;
  const now = Date.now();
  const formatPairAge = (pairCreatedAt?: number): string => {
    if (!pairCreatedAt || !Number.isFinite(pairCreatedAt)) return "n/a";
    const hours = Math.max(0, Math.floor((now - pairCreatedAt) / (1000 * 60 * 60)));
    if (hours < 1) return "<1h";
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d`;
    return `${Math.floor(days / 30)}mo`;
  };
  const isRecentlyCreated = (pairCreatedAt?: number, maxHours = 24): boolean => {
    if (!pairCreatedAt || !Number.isFinite(pairCreatedAt)) return false;
    return now - pairCreatedAt <= maxHours * 60 * 60 * 1000;
  };
  const cloneList = token.sameTickerTokens ?? [];
  const canonicalCandidate =
    cloneList.find((item) => item.isExactMintMatch) ?? cloneList[0];
  const canonicalPairAge = formatPairAge(canonicalCandidate?.pairCreatedAt);
  const recentCloneCount = cloneList.filter(
    (item) => !item.isExactMintMatch && isRecentlyCreated(item.pairCreatedAt, 24)
  ).length;
  const compactError = (value: string): string =>
    value.split("\n")[0]?.trim().slice(0, 220) || "unknown error";
  const pump = token.pumpPortal;
  const pumpRecentTrades = pump?.recentTrades ?? [];

  const dedupedImages = Array.from(
    new Set(
      [
        ...(token.imageUris ?? []),
        token.imageUri,
        ...(token.sameTickerTokens ?? []).flatMap((item) => [
          item.imageUri,
          ...(item.imageUris ?? []),
        ]),
      ].filter((value): value is string => !!value && value.trim().length > 0)
    )
  );

  push(`{"op":"add","path":"/root","value":"card-main"}`);
  const mainChildren: string[] = ["token-badges", "token-main-row"];

  if (coinDetail) {
    mainChildren.push("token-badge-super");
    push(
      `{"op":"add","path":"/elements/token-badge-super","value":{"type":"Badge","props":{"label":"EXHAUSTIVE TERMINAL v1.0","variant":"info"},"children":[]}}`
    );
  }

  // ── Status badges ──
  push(
    `{"op":"add","path":"/elements/token-badge-mode","value":{"type":"Badge","props":{"label":"${esc((token.lookupMode || "mint").toUpperCase())} LOOKUP","variant":"info"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/token-badge-grade","value":{"type":"Badge","props":{"label":"TRUST ${esc(trustGrade)}","variant":"${trustScoreValue >= 80 ? "success" : trustScoreValue >= 60 ? "warning" : "danger"}"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/token-badge-clones","value":{"type":"Badge","props":{"label":"${sameTickerCount} SAME TICKER","variant":"${sameTickerCount > 1 ? "warning" : "default"}"},"children":[]}}`
  );
  if (isRecentlyCreated(canonicalCandidate?.pairCreatedAt, 24)) {
    push(
      `{"op":"add","path":"/elements/token-badge-fresh","value":{"type":"Badge","props":{"label":"NEW <24H","variant":"warning"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-badges","value":{"type":"Stack","props":{"gap":"sm","direction":"horizontal"},"children":["token-badge-mode","token-badge-grade","token-badge-clones","token-badge-fresh"]}}`
    );
  } else {
    push(
      `{"op":"add","path":"/elements/token-badges","value":{"type":"Stack","props":{"gap":"sm","direction":"horizontal"},"children":["token-badge-mode","token-badge-grade","token-badge-clones"]}}`
    );
  }

  // ── Degen Gauge (Viral) ──
  mainChildren.push("token-degen-gauge");
  const gaugeColor = trustScoreValue >= 80 ? "emerald" : trustScoreValue >= 60 ? "amber" : "red";
  push(
    `{"op":"add","path":"/elements/token-degen-gauge","value":{"type":"DegenGauge","props":{"score":${trustScoreValue},"label":"Trust Level","color":"${gaugeColor}","size":"md"},"children":[]}}`
  );

  // ── Hero row ──
  push(
    `{"op":"add","path":"/elements/token-row","value":{"type":"TokenRow","props":{"name":"${esc(name)}","symbol":"${esc(symbol)}","imageUrl":${token.imageUri ? `"${esc(token.imageUri)}"` : "null"},"price":"${esc(shortMint)}","change":${trust ? `"Trust ${esc(`${trust.score}/100`)}"` : "null"},"sparklineData":null,"rank":null},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/token-summary","value":{"type":"Text","props":{"content":"Mint ${esc(mint)}. ${sameTickerCount} same-ticker candidates found; ${suspiciousCount} flagged medium/high risk."},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/token-main-row","value":{"type":"Stack","props":{"gap":"md","direction":"vertical"},"children":["token-row","token-summary"]}}`
  );

  // ── Dashboard Body Layout ──
  if (coinDetail) {
    // Super mode uses a 2-column dashboard layout
    mainChildren.push("token-dashboard-middle");
    push(
      `{"op":"add","path":"/elements/token-col-left","value":{"type":"Stack","props":{"gap":"md","direction":"vertical"},"children":["token-metrics-row","token-degen-gauge"]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-col-right","value":{"type":"Stack","props":{"gap":"md","direction":"vertical"},"children":["div-socials","token-socials","token-detail-metrics"]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-dashboard-middle","value":{"type":"Stack","props":{"gap":"lg","direction":"horizontal"},"children":["token-col-left","token-col-right"]}}`
    );
  } else {
    // Regular mode is more linear
    mainChildren.push("token-metrics-row", "token-degen-gauge");
  }

  // ── Metrics ──
  push(
    `{"op":"add","path":"/elements/token-m-trust","value":{"type":"Metric","props":{"label":"Trust Score","value":"${trust ? `${trust.score}/100 (${trust.grade})` : "Unavailable"}","format":"number"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/token-m-same","value":{"type":"Metric","props":{"label":"Same Ticker Tokens","value":"${sameTickerCount}","format":"number"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/token-m-risk","value":{"type":"Metric","props":{"label":"Suspicious Matches","value":"${suspiciousCount}","format":"number"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/token-m-fresh","value":{"type":"Metric","props":{"label":"Canonical Pair Age","value":"${esc(canonicalPairAge)}","format":"number"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/token-m-newclones","value":{"type":"Metric","props":{"label":"New Clones <24h","value":"${recentCloneCount}","format":"number"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/token-m-img","value":{"type":"Metric","props":{"label":"Images Collected","value":"${dedupedImages.length}","format":"number"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/token-metrics-row","value":{"type":"Stack","props":{"gap":"md","direction":"vertical"},"children":["token-m-trust","token-m-same","token-m-risk","token-m-fresh","token-m-newclones"]}}`
  );

  // ── Project Socials & Links (Viral) ──
  if (coinDetail) {
    push(
      `{"op":"add","path":"/elements/div-socials","value":{"type":"Divider","props":{"label":"Project & Community"},"children":[]}}`
    );

    const sLinks: any[] = [];
    if (coinDetail.links.twitter_screen_name) {
      sLinks.push({ type: "x", url: `https://x.com/${coinDetail.links.twitter_screen_name}` });
    }
    if (coinDetail.links.telegram_channel_identifier) {
      sLinks.push({ type: "telegram", url: `https://t.me/${coinDetail.links.telegram_channel_identifier}` });
    }
    if (coinDetail.links.discord_link) {
      sLinks.push({ type: "discord", url: coinDetail.links.discord_link });
    }
    if (coinDetail.links.homepage?.[0]) {
      sLinks.push({ type: "website", url: coinDetail.links.homepage[0] });
    }
    if (coinDetail.links.repos_url.github?.[0]) {
      sLinks.push({ type: "github", url: coinDetail.links.repos_url.github[0] });
    }

    push(
      `{"op":"add","path":"/elements/token-socials","value":{"type":"SocialLinks","props":{"links":${JSON.stringify(sLinks)}},"children":[]}}`
    );

    push(
      `{"op":"add","path":"/elements/token-det-m-comm","value":{"type":"Metric","props":{"label":"Community Score","value":"${coinDetail.community_score.toFixed(1)}/100","format":"number"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-det-m-dev","value":{"type":"Metric","props":{"label":"Developer Score","value":"${coinDetail.developer_score.toFixed(1)}/100","format":"number"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-detail-metrics","value":{"type":"Stack","props":{"gap":"md","direction":"horizontal"},"children":["token-det-m-comm","token-det-m-dev"]}}`
    );
  }

  // ── Trust reasons ──
  if (trust?.reasons?.length) {
    mainChildren.push("token-div-trust", "token-table-trust");
    push(
      `{"op":"add","path":"/elements/token-div-trust","value":{"type":"Divider","props":{"label":"Trust Breakdown"},"children":[]}}`
    );
    const trustCols = ["Reason", "Impact", "Detail", "Link"];
    const trustRows = trust.reasons.map((reason) => [
      reason.label,
      `${reason.impact >= 0 ? "+" : ""}${reason.impact}`,
      reason.detail,
      reason.link || "-",
    ]);
    push(
      `{"op":"add","path":"/elements/token-table-trust","value":{"type":"Table","props":{"columns":${JSON.stringify(trustCols)},"rows":${JSON.stringify(
        trustRows.map((row) => row.map((cell) => esc(cell)))
      )}},"children":[]}}`
    );
  }

  // ── Same ticker tokens table ──
  if ((token.sameTickerTokens?.length ?? 0) > 0) {
    mainChildren.push("token-div-clones", "token-table-clones");
    push(
      `{"op":"add","path":"/elements/token-div-clones","value":{"type":"Divider","props":{"label":"Same Ticker Tokens"},"children":[]}}`
    );
    const riskRank = (risk: "canonical" | "low" | "medium" | "high"): number => {
      if (risk === "canonical") return 0;
      if (risk === "high") return 3;
      if (risk === "medium") return 2;
      if (risk === "low") return 1;
      return 0;
    };
    const sortedClones = [...(token.sameTickerTokens ?? [])]
      .sort((a, b) => {
        if (a.isExactMintMatch && !b.isExactMintMatch) return -1;
        if (!a.isExactMintMatch && b.isExactMintMatch) return 1;
        const riskDiff = riskRank(b.risk) - riskRank(a.risk);
        if (riskDiff !== 0) return riskDiff;
        return (b.pairCreatedAt ?? 0) - (a.pairCreatedAt ?? 0);
      });
    const cloneCols = [
      "Symbol",
      "Mint",
      "Risk",
      "Risk Notes",
      "Pair Age",
      "Liquidity",
      "24h Volume",
      "Mint Link",
      "Pair Link",
    ];
    const cloneRows = sortedClones.map((item) => [
      item.name ? `${item.symbol} (${item.name})` : item.symbol,
      `${item.mint.slice(0, 4)}...${item.mint.slice(-4)}`,
      item.risk.toUpperCase(),
      item.riskReasons.length > 0 ? item.riskReasons.join("; ") : "-",
      formatPairAge(item.pairCreatedAt),
      item.liquidityUsd != null ? formatCompact(item.liquidityUsd) : "-",
      item.volume24hUsd != null ? formatCompact(item.volume24hUsd) : "-",
      `https://explorer.solana.com/address/${item.mint}`,
      item.url || "-",
    ]);
    push(
      `{"op":"add","path":"/elements/token-table-clones","value":{"type":"Table","props":{"columns":${JSON.stringify(cloneCols)},"rows":${JSON.stringify(
        cloneRows.map((row) => row.map((cell) => esc(cell)))
      )}},"children":[]}}`
    );
  }

  // ── Image grid (all discovered images) ──
  if (dedupedImages.length > 0) {
    mainChildren.push("token-div-images");
    push(
      `{"op":"add","path":"/elements/token-div-images","value":{"type":"Divider","props":{"label":"Token Images"},"children":[]}}`
    );
    const imageKeys: string[] = [];
    dedupedImages.forEach((src, idx) => {
      const imageKey = `token-image-${idx}`;
      imageKeys.push(imageKey);
      push(
        `{"op":"add","path":"/elements/${imageKey}","value":{"type":"Image","props":{"src":"${esc(src)}","alt":"${esc(`${symbol} image ${idx + 1}`)}","width":96,"height":96,"rounded":"md"},"children":[]}}`
      );
    });

    const rowKeys: string[] = [];
    for (let i = 0; i < imageKeys.length; i += 4) {
      const rowKey = `token-image-row-${Math.floor(i / 4)}`;
      const rowChildren = imageKeys.slice(i, i + 4);
      rowKeys.push(rowKey);
      push(
        `{"op":"add","path":"/elements/${rowKey}","value":{"type":"Stack","props":{"gap":"sm","direction":"horizontal"},"children":${JSON.stringify(rowChildren)}}}`
      );
    }
    push(
      `{"op":"add","path":"/elements/token-image-stack","value":{"type":"Stack","props":{"gap":"sm","direction":"vertical"},"children":${JSON.stringify(rowKeys)}}}`
    );
    mainChildren.push("token-image-stack");
  }

  // ── PumpPortal trade telemetry (new/fresh memecoin coverage) ──
  if (pump && pump.recentTradeCount > 0) {
    mainChildren.push("token-div-pump", "token-pump-metrics");
    push(
      `{"op":"add","path":"/elements/token-div-pump","value":{"type":"Divider","props":{"label":"PumpPortal Trade Flow"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-pump-m-trades","value":{"type":"Metric","props":{"label":"Recent Trades","value":"${pump.recentTradeCount}","format":"number"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-pump-m-sides","value":{"type":"Metric","props":{"label":"Buys / Sells","value":"${pump.buyCount} / ${pump.sellCount}","format":"number"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-pump-m-sol","value":{"type":"Metric","props":{"label":"Observed SOL Vol","value":"${esc(
        formatSolCompact(pump.totalSolVolume)
      )}","format":"number"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-pump-m-mcap","value":{"type":"Metric","props":{"label":"Latest MCAP","value":"${esc(
        formatSolCompact(pump.latestMarketCapSol)
      )}","format":"number"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-pump-metrics","value":{"type":"Stack","props":{"gap":"md","direction":"horizontal"},"children":["token-pump-m-trades","token-pump-m-sides","token-pump-m-sol","token-pump-m-mcap"]}}`
    );

    if (pumpRecentTrades.length > 0) {
      mainChildren.push("token-pump-table");
      const pumpColumns = [
        "Side",
        "SOL",
        "Token Amt",
        "MCAP (SOL)",
        "Trader",
        "Time",
        "Tx",
      ];
      const pumpRows = pumpRecentTrades.slice(0, 20).map((trade) => [
        (trade.txType ?? "trade").toUpperCase(),
        trade.solAmount != null ? formatSolCompact(trade.solAmount) : "-",
        trade.tokenAmount != null ? Number(trade.tokenAmount).toLocaleString() : "-",
        trade.marketCapSol != null ? formatSolCompact(trade.marketCapSol) : "-",
        trade.traderPublicKey
          ? `https://solscan.io/account/${trade.traderPublicKey}`
          : "-",
        formatPumpTimestamp(trade.timestamp),
        `https://solscan.io/tx/${trade.signature}`,
      ]);
      push(
        `{"op":"add","path":"/elements/token-pump-table","value":{"type":"Table","props":{"columns":${JSON.stringify(
          pumpColumns
        )},"rows":${JSON.stringify(
          pumpRows.map((row) => row.map((cell) => esc(cell)))
        )}},"children":[]}}`
      );
    }
  }

  // CoinGecko Price Chart Widget
  if (symbol && symbol !== "UNK") {
    mainChildren.push("token-div-chart", "token-chart-widget");
    push(
      `{"op":"add","path":"/elements/token-div-chart","value":{"type":"Divider","props":{"label":"CoinGecko Price Chart"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-chart-widget","value":{"type":"Widget","props":{"type":"price-chart","coinId":"${esc(symbol.toLowerCase())}","currency":"usd","height":400},"children":[]}}`
    );
  }

  // ── Actions ──
  mainChildren.push("token-actions-row");
  push(
    `{"op":"add","path":"/elements/token-btn-mint","value":{"type":"Button","props":{"label":"View Mint","action":"navigate","params":{"url":"${esc(`https://explorer.solana.com/address/${mint}`)}"}},"children":[]}}`
  );
  const actionKeys = ["token-btn-mint"];
  if (trust?.hardLinks?.pair) {
    actionKeys.push("token-btn-pair");
    push(
      `{"op":"add","path":"/elements/token-btn-pair","value":{"type":"Button","props":{"label":"View Pair","action":"navigate","params":{"url":"${esc(trust.hardLinks.pair)}"}},"children":[]}}`
    );
  }
  if (trust?.hardLinks?.liquidity) {
    actionKeys.push("token-btn-liq");
    push(
      `{"op":"add","path":"/elements/token-btn-liq","value":{"type":"Button","props":{"label":"Liquidity","action":"navigate","params":{"url":"${esc(trust.hardLinks.liquidity)}"}},"children":[]}}`
    );
  }
  if (trust?.hardLinks?.tx) {
    actionKeys.push("token-btn-tx");
    push(
      `{"op":"add","path":"/elements/token-btn-tx","value":{"type":"Button","props":{"label":"Reference Tx","action":"navigate","params":{"url":"${esc(trust.hardLinks.tx)}"}},"children":[]}}`
    );
  }
  if (pump?.mint) {
    actionKeys.push("token-btn-pumpfun", "token-btn-pumpportal");
    push(
      `{"op":"add","path":"/elements/token-btn-pumpfun","value":{"type":"Button","props":{"label":"Open pump.fun","action":"navigate","params":{"url":"${esc(
        `https://pump.fun/coin/${pump.mint}`
      )}"}},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-btn-pumpportal","value":{"type":"Button","props":{"label":"Open PumpPortal","action":"navigate","params":{"url":"https://pumpportal.fun"}},"children":[]}}`
    );
  }
  push(
    `{"op":"add","path":"/elements/token-actions-row","value":{"type":"Stack","props":{"gap":"sm","direction":"horizontal"},"children":${JSON.stringify(actionKeys)}}}`
  );

  // ── Viral share pack actions ──
  if (sharePack) {
    mainChildren.push(
      "token-div-share",
      "token-share-summary",
      "token-share-hook",
      "token-share-actions-primary",
      "token-share-actions-secondary"
    );
    push(
      `{"op":"add","path":"/elements/token-div-share","value":{"type":"Divider","props":{"label":"Share Pack"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-share-summary","value":{"type":"Text","props":{"content":"${esc(
        sharePack.summary
      )}"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-share-hook","value":{"type":"AlertBanner","props":{"title":"Hype Hook","message":"${esc(
        sharePack.hypeHook
      )}","severity":"alpha"},"children":[]}}`
    );

    push(
      `{"op":"add","path":"/elements/token-share-btn-x","value":{"type":"Button","props":{"label":"Open X Thread","action":"navigate","params":{"url":"${esc(
        sharePack.xIntentUrl
      )}"}},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-share-btn-farcaster","value":{"type":"Button","props":{"label":"Open Farcaster","action":"navigate","params":{"url":"${esc(
        sharePack.farcasterIntentUrl
      )}"}},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-share-btn-og","value":{"type":"Button","props":{"label":"Open Image Card","action":"navigate","params":{"url":"${esc(
        sharePack.ogImageUrl
      )}"}},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-share-actions-primary","value":{"type":"Stack","props":{"gap":"sm","direction":"horizontal"},"children":["token-share-btn-x","token-share-btn-farcaster","token-share-btn-og"]}}`
    );

    push(
      `{"op":"add","path":"/elements/token-share-btn-copy-thread","value":{"type":"Button","props":{"label":"Copy Thread","action":"copy","params":{"text":"${esc(
        sharePack.threadText
      )}"}},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-share-btn-copy-video-prompt","value":{"type":"Button","props":{"label":"Copy Hype Prompt","action":"copy","params":{"text":"${esc(
        sharePack.hypePromptTemplate
      )}"}},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-share-btn-copy-timeline","value":{"type":"Button","props":{"label":"Copy Video Timeline","action":"copy","params":{"text":"${esc(
        sharePack.timelineJson
      )}"}},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-share-actions-secondary","value":{"type":"Stack","props":{"gap":"sm","direction":"horizontal"},"children":["token-share-btn-copy-thread","token-share-btn-copy-video-prompt","token-share-btn-copy-timeline"]}}`
    );
  }

  // ── Convex workflow enrichment (fan-out narrative/meta telemetry) ──
  if (convexIntel) {
    mainChildren.push(
      "token-div-convex",
      "token-convex-metrics",
      "token-convex-summary"
    );
    push(
      `{"op":"add","path":"/elements/token-div-convex","value":{"type":"Divider","props":{"label":"Convex Meta Intel"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-cx-rag","value":{"type":"Metric","props":{"label":"Narrative Hits","value":"${convexIntel.narrativeHits}","format":"number"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-cx-docs","value":{"type":"Metric","props":{"label":"Tracked Docs","value":"${convexIntel.symbolDocsCount}","format":"number"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-cx-watch","value":{"type":"Metric","props":{"label":"Active Watchers","value":"${convexIntel.watchlistCount}","format":"number"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-cx-susp","value":{"type":"Metric","props":{"label":"Suspicious Docs","value":"${convexIntel.suspiciousDocsCount}","format":"number"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-convex-metrics","value":{"type":"Stack","props":{"gap":"md","direction":"horizontal"},"children":["token-cx-rag","token-cx-docs","token-cx-watch","token-cx-susp"]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-convex-summary","value":{"type":"Text","props":{"content":"${esc(
        convexIntel.narrativeSummary?.trim() ||
        "Workflow completed. Narrative summary unavailable."
      )}"},"children":[]}}`
    );

    if ((convexIntel.topClusters?.length ?? 0) > 0) {
      mainChildren.push("token-convex-clusters");
      const clusterCols = ["Symbol", "Score", "Suspicious Ratio", "Acceleration", "Summary"];
      const clusterRows = convexIntel.topClusters.slice(0, 6).map((cluster) => [
        cluster.symbol,
        cluster.clusterScore.toFixed(1),
        `${(cluster.suspiciousRatio * 100).toFixed(1)}%`,
        String(cluster.acceleration),
        cluster.summary,
      ]);
      push(
        `{"op":"add","path":"/elements/token-convex-clusters","value":{"type":"Table","props":{"columns":${JSON.stringify(
          clusterCols
        )},"rows":${JSON.stringify(
          clusterRows.map((row) => row.map((cell) => esc(cell)))
        )}},"children":[]}}`
      );
    }

    if ((convexIntel.telemetryTop?.length ?? 0) > 0) {
      mainChildren.push("token-convex-telemetry");
      const bars = convexIntel.telemetryTop.slice(0, 8).map((event, idx) => ({
        label: event.event.length > 24 ? `${event.event.slice(0, 21)}...` : event.event,
        value: event.count,
        color: ["cyan", "emerald", "amber", "violet", "red", "cyan", "emerald", "amber"][
          idx % 8
        ],
      }));
      push(
        `{"op":"add","path":"/elements/token-convex-telemetry","value":{"type":"BarChart","props":{"bars":${JSON.stringify(
          bars
        )}},"children":[]}}`
      );
    }

    if ((convexIntel.errors?.length ?? 0) > 0) {
      mainChildren.push("token-convex-errors");
      push(
        `{"op":"add","path":"/elements/token-convex-errors","value":{"type":"AlertBanner","props":{"title":"Partial Convex Data","message":"${esc(
          convexIntel.errors.slice(0, 2).map(compactError).join(" | ")
        )}","severity":"warning"},"children":[]}}`
      );
    }
  }

  // ── Final Actions & Interactive Upgrades ──
  if (!coinDetail) {
    mainChildren.push("div-upgrade", "token-btn-super");
    push(
      `{"op":"add","path":"/elements/div-upgrade","value":{"type":"Divider","props":{"label":"Action Required"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/token-btn-super","value":{"type":"Button","props":{"label":"Run Super Analysis (Exhaustive)","action":"generate","params":{"prompt":"exhaustive terminal intel for ${esc(symbol)}"}},"children":[]}}`
    );
  }

  push(
    `{"op":"add","path":"/elements/token-main","value":{"type":"Stack","props":{"gap":"lg","direction":"vertical"},"children":${JSON.stringify(mainChildren)}}}`
  );
  const title = coinDetail
    ? `TERMINAL: ${symbol} EXHAUSTIVE`
    : prompt && prompt.length > 60
      ? `${prompt.slice(0, 57)}...`
      : prompt || `${symbol} Token Intel`;
  push(
    `{"op":"add","path":"/elements/card-main","value":{"type":"Card","props":{"title":"${esc(title)}","description":"Mint + same-ticker scan + trust scoring"},"children":["token-main"]}}`
  );

  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════
// SPEC BUILDER: Crypto Market Dashboard (CoinGecko real data)
// ══════════════════════════════════════════════════════════════════
function buildMarketSpec(
  coins: CoinMarketData[],
  globalData: GlobalData | null,
  trending: TrendingCoinItem[],
  prompt: string
): string {
  const lines: string[] = [];
  const push = (line: string) => lines.push(line);

  push(`{"op":"add","path":"/root","value":"card-main"}`);

  const mainChildren: string[] = [];

  // ── Global metrics ──
  if (globalData) {
    mainChildren.push("global-row");
    const totalMcap = globalData.total_market_cap?.usd ?? 0;
    const totalVol = globalData.total_volume?.usd ?? 0;
    const btcDom = globalData.market_cap_percentage?.btc ?? 0;
    const ethDom = globalData.market_cap_percentage?.eth ?? 0;
    const change24h = globalData.market_cap_change_percentage_24h_usd ?? 0;

    push(
      `{"op":"add","path":"/elements/gm-mcap","value":{"type":"Metric","props":{"label":"Total Market Cap","value":"${esc(formatUsd(totalMcap))}","format":"currency","change":"${esc(formatPct(change24h))}"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/gm-vol","value":{"type":"Metric","props":{"label":"24h Volume","value":"${esc(formatUsd(totalVol))}","format":"currency"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/gm-btcdom","value":{"type":"Metric","props":{"label":"BTC Dominance","value":"${btcDom.toFixed(1)}%","format":"percent"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/gm-ethdom","value":{"type":"Metric","props":{"label":"ETH Dominance","value":"${ethDom.toFixed(1)}%","format":"percent"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/global-row","value":{"type":"Stack","props":{"gap":"md","direction":"horizontal"},"children":["gm-mcap","gm-vol","gm-btcdom","gm-ethdom"]}}`
    );

    // Dominance donut chart
    mainChildren.push("dom-donut");
    const otherDom = Math.max(0, 100 - btcDom - ethDom);
    push(
      `{"op":"add","path":"/elements/dom-donut","value":{"type":"DonutChart","props":{"segments":[{"label":"BTC","value":${btcDom.toFixed(1)},"color":"amber"},{"label":"ETH","value":${ethDom.toFixed(1)},"color":"cyan"},{"label":"Alts","value":${otherDom.toFixed(1)},"color":"violet"}],"size":100},"children":[]}}`
    );
  }

  // ── Top coins table ──
  if (coins.length > 0) {
    mainChildren.push("div-top", "top-table");
    push(
      `{"op":"add","path":"/elements/div-top","value":{"type":"Divider","props":{"label":"Top Coins by Market Cap"},"children":[]}}`
    );

    const tableCols = ["#", "Coin", "Price", "24h", "7d", "Market Cap", "Volume"];
    const tableRows = coins.slice(0, 15).map((c) => [
      String(c.market_cap_rank ?? "-"),
      `${c.name} (${c.symbol.toUpperCase()})`,
      formatUsd(c.current_price),
      formatPct(c.price_change_percentage_24h),
      formatPct(c.price_change_percentage_7d_in_currency),
      formatUsd(c.market_cap),
      formatUsd(c.total_volume),
    ]);

    push(
      `{"op":"add","path":"/elements/top-table","value":{"type":"Table","props":{"columns":${JSON.stringify(tableCols)},"rows":${JSON.stringify(tableRows.map((r) => r.map((c) => esc(c))))}},"children":[]}}`
    );

    // TokenRow for top coins with images
    coins.slice(0, 5).forEach((c, i) => {
      const tokenKey = `market-token-${i}`;
      mainChildren.push(tokenKey);
      const sparkData = c.sparkline_in_7d?.price?.length ? JSON.stringify(downsample(c.sparkline_in_7d.price, 20)) : "null";
      const change24 = c.price_change_percentage_24h != null ? `"${esc(formatPct(c.price_change_percentage_24h))}"` : "null";
      const imageUrl = c.image ? `"${esc(c.image)}"` : "null";
      push(
        `{"op":"add","path":"/elements/${tokenKey}","value":{"type":"TokenRow","props":{"name":"${esc(c.name)}","symbol":"${esc(c.symbol.toUpperCase())}","imageUrl":${imageUrl},"price":"${esc(formatUsd(c.current_price))}","change":${change24},"sparklineData":${sparkData},"rank":${c.market_cap_rank ?? "null"}},"children":[]}}`
      );
    });

    // Sparklines for top 3 coins
    const topSparkCoins = coins.slice(0, 3).filter((c) => c.sparkline_in_7d?.price?.length);
    if (topSparkCoins.length > 0) {
      mainChildren.push("div-charts", "charts-row");
      push(
        `{"op":"add","path":"/elements/div-charts","value":{"type":"Divider","props":{"label":"7-Day Price Charts"},"children":[]}}`
      );

      const chartKeys: string[] = [];
      topSparkCoins.forEach((c, i) => {
        const key = `spark-${i}`;
        const labelKey = `spark-label-${i}`;
        const wrapKey = `spark-wrap-${i}`;
        chartKeys.push(wrapKey);

        const sparkData = downsample(c.sparkline_in_7d!.price, 40);
        const isUp = sparkData[sparkData.length - 1] >= sparkData[0];

        push(
          `{"op":"add","path":"/elements/${labelKey}","value":{"type":"Heading","props":{"text":"${esc(c.symbol.toUpperCase())} — ${esc(formatUsd(c.current_price))} (${esc(formatPct(c.price_change_percentage_7d_in_currency))})","size":"sm"},"children":[]}}`
        );
        push(
          `{"op":"add","path":"/elements/${key}","value":{"type":"SparkLine","props":{"data":${JSON.stringify(sparkData)},"color":"${isUp ? "emerald" : "red"}","height":56},"children":[]}}`
        );
        push(
          `{"op":"add","path":"/elements/${wrapKey}","value":{"type":"Stack","props":{"gap":"sm","direction":"vertical"},"children":["${labelKey}","${key}"]}}`
        );
      });

      push(
        `{"op":"add","path":"/elements/charts-row","value":{"type":"Stack","props":{"gap":"md","direction":"vertical"},"children":${JSON.stringify(chartKeys)}}}`
      );
    }

    // Top 10 volume bar chart
    mainChildren.push("div-volume", "volume-bars");
    push(
      `{"op":"add","path":"/elements/div-volume","value":{"type":"Divider","props":{"label":"24h Volume Leaders"},"children":[]}}`
    );
    const volBars = coins.slice(0, 8).map((c, i) => {
      const colors = ["emerald", "cyan", "amber", "violet", "red", "emerald", "cyan", "amber"];
      return `{"label":"${esc(c.symbol.toUpperCase())}","value":${Math.round(c.total_volume / 1e6)},"color":"${colors[i]}"}`;
    });
    push(
      `{"op":"add","path":"/elements/volume-bars","value":{"type":"BarChart","props":{"bars":[${volBars.join(",")}]},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/vol-note","value":{"type":"Text","props":{"content":"Volume shown in millions USD"},"children":[]}}`
    );
    mainChildren.push("vol-note");

    // Heatmap widget
    mainChildren.push("div-heatmap", "market-heatmap");
    push(
      `{"op":"add","path":"/elements/div-heatmap","value":{"type":"Divider","props":{"label":"Market Heatmap"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/market-heatmap","value":{"type":"Widget","props":{"type":"heatmap","coinId":null,"currency":"usd","height":400},"children":[]}}`
    );
  }

  // ── Trending coins ──
  if (trending.length > 0) {
    mainChildren.push("div-trending", "trending-heading", "trending-table");
    push(
      `{"op":"add","path":"/elements/div-trending","value":{"type":"Divider","props":{"label":"Trending"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/trending-heading","value":{"type":"Heading","props":{"text":"Trending on CoinGecko (by search activity)","size":"sm"},"children":[]}}`
    );

    const trendCols = ["Coin", "Symbol", "Rank"];
    const trendRows = trending.slice(0, 8).map((t) => [
      t.name,
      t.symbol.toUpperCase(),
      t.market_cap_rank ? `#${t.market_cap_rank}` : "-",
    ]);

    push(
      `{"op":"add","path":"/elements/trending-table","value":{"type":"Table","props":{"columns":${JSON.stringify(trendCols)},"rows":${JSON.stringify(trendRows.map((r) => r.map((c) => esc(c))))}},"children":[]}}`
    );
  }

  // ── Whale Radar (Viral) ──
  if (trending.length > 0) {
    mainChildren.push("div-radar", "market-radar");
    push(
      `{"op":"add","path":"/elements/div-radar","value":{"type":"Divider","props":{"label":"Hot Activity Radar"},"children":[]}}`
    );
    const radarPoints = trending.slice(0, 6).map((t, i) => {
      const angle = (i / 6) * Math.PI * 2;
      const dist = 0.4 + Math.random() * 0.5;
      return {
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        size: 40 + Math.random() * 60,
        label: t.symbol.toUpperCase(),
      };
    });
    push(
      `{"op":"add","path":"/elements/market-radar","value":{"type":"WhaleRadar","props":{"points":${JSON.stringify(radarPoints)},"color":"cyan","size":220},"children":[]}}`
    );
  }

  // ── Analysis text ──
  mainChildren.push("analysis-text");
  let analysis = "Data sourced live from CoinGecko.";
  if (coins.length >= 3 && globalData) {
    const btc = coins.find((c) => c.symbol === "btc");
    const eth = coins.find((c) => c.symbol === "eth");
    const sol = coins.find((c) => c.symbol === "sol");
    const parts: string[] = [];
    if (btc)
      parts.push(
        `BTC at ${formatUsd(btc.current_price)} (${formatPct(btc.price_change_percentage_24h)} 24h)`
      );
    if (eth)
      parts.push(
        `ETH at ${formatUsd(eth.current_price)} (${formatPct(eth.price_change_percentage_24h)} 24h)`
      );
    if (sol)
      parts.push(
        `SOL at ${formatUsd(sol.current_price)} (${formatPct(sol.price_change_percentage_24h)} 24h)`
      );
    const mcapChange = globalData.market_cap_change_percentage_24h_usd;
    const sentiment =
      mcapChange > 2
        ? "Market strongly bullish."
        : mcapChange > 0
          ? "Market slightly green."
          : mcapChange > -2
            ? "Market slightly red."
            : "Market under pressure.";
    analysis = `${parts.join(" | ")}. ${sentiment} Total market cap ${formatUsd(globalData.total_market_cap?.usd ?? 0)}.`;
  }
  push(
    `{"op":"add","path":"/elements/analysis-text","value":{"type":"Text","props":{"content":"${esc(analysis)}"},"children":[]}}`
  );

  // ── Buttons ──
  mainChildren.push("btns-row");
  push(
    `{"op":"add","path":"/elements/btn-cg","value":{"type":"Button","props":{"label":"View on CoinGecko","action":"navigate","params":{"url":"https://www.coingecko.com"}},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/btn-dex","value":{"type":"Button","props":{"label":"View on DexScreener","action":"navigate","params":{"url":"https://dexscreener.com"}},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/btns-row","value":{"type":"Stack","props":{"gap":"sm","direction":"horizontal"},"children":["btn-cg","btn-dex","market-btn-super"]}}`
  );

  // ── Final Actions & Interactive Upgrades ──
  mainChildren.push("div-market-upgrade", "market-btn-super");
  push(
    `{"op":"add","path":"/elements/div-market-upgrade","value":{"type":"Divider","props":{"label":"Deep Analysis Required"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/market-btn-super","value":{"type":"Button","props":{"label":"Run Total Market Alpha","action":"generate","params":{"prompt":"exhaustive terminal market alpha dashboard"}},"children":[]}}`
  );

  // ── Assemble ──
  const title = prompt
    ? prompt.length > 50
      ? prompt.slice(0, 47) + "..."
      : prompt
    : "Crypto Market Overview";
  push(
    `{"op":"add","path":"/elements/main-stack","value":{"type":"Stack","props":{"gap":"lg","direction":"vertical"},"children":${JSON.stringify(mainChildren)}}}`
  );
  push(
    `{"op":"add","path":"/elements/card-main","value":{"type":"Card","props":{"title":"${esc(title)}","description":"Live data from CoinGecko"},"children":["main-stack"]}}`
  );

  return lines.join("\n");
}

function formatSolCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M SOL`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K SOL`;
  if (value >= 1) return `${value.toFixed(2)} SOL`;
  return `${value.toFixed(4)} SOL`;
}

function formatPumpTimestamp(timestamp: number | undefined): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return "-";
  const ms = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ══════════════════════════════════════════════════════════════════
// SPEC BUILDER: PumpPortal Memecoin Dashboard (real-time WS data)
// ══════════════════════════════════════════════════════════════════
function buildPumpSpec(snapshot: PumpSnapshot, prompt: string): string {
  const lines: string[] = [];
  const push = (line: string) => lines.push(line);

  push(`{"op":"add","path":"/root","value":"card-main"}`);

  const mainChildren: string[] = [];
  const totalSolVolume = snapshot.recentTrades.reduce(
    (sum, t) => sum + (t.solAmount ?? 0),
    0
  );
  const buyTrades = snapshot.recentTrades.filter((t) => t.txType === "buy");
  const sellTrades = snapshot.recentTrades.filter((t) => t.txType === "sell");
  const buySol = buyTrades.reduce((sum, t) => sum + (t.solAmount ?? 0), 0);
  const sellSol = sellTrades.reduce((sum, t) => sum + (t.solAmount ?? 0), 0);
  const netFlow = buySol - sellSol;
  const flowBias = totalSolVolume > 0 ? netFlow / totalSolVolume : 0;
  const pulseScore = Math.round(
    Math.min(
      100,
      Math.min(45, snapshot.newTokens.length * 8) +
      Math.min(35, snapshot.recentTrades.length * 2 + totalSolVolume * 1.5) +
      Math.min(20, snapshot.migrations.length * 6)
    )
  );
  const pulseColor =
    pulseScore >= 70 ? "emerald" : pulseScore >= 45 ? "amber" : "cyan";
  const flowLabel =
    flowBias > 0.15 ? "BUY HEAVY" : flowBias < -0.15 ? "SELL HEAVY" : "BALANCED";
  const flowVariant =
    flowBias > 0.15 ? "success" : flowBias < -0.15 ? "danger" : "info";

  // ── Status + pulse score ──
  mainChildren.push("pump-status-row", "pump-score-row", "pump-metrics-row");
  push(
    `{"op":"add","path":"/elements/pump-badge-live","value":{"type":"Badge","props":{"label":"LIVE 4S WINDOW","variant":"default"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-badge-flow","value":{"type":"Badge","props":{"label":"${flowLabel}","variant":"${flowVariant}"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-badge-velocity","value":{"type":"Badge","props":{"label":"${snapshot.newTokens.length} LAUNCHES","variant":"warning"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-status-row","value":{"type":"Stack","props":{"gap":"sm","direction":"horizontal"},"children":["pump-badge-live","pump-badge-flow","pump-badge-velocity"]}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-score-ring","value":{"type":"ScoreRing","props":{"score":${pulseScore},"label":"PUMP PULSE","color":"${pulseColor}","size":"md"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-score-text","value":{"type":"Text","props":{"content":"Pulse score blends launch velocity, migration activity, and observed SOL flow over the capture window."},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-score-row","value":{"type":"Stack","props":{"gap":"md","direction":"horizontal"},"children":["pump-score-ring","pump-score-text"]}}`
  );

  // ── Summary metrics ──
  push(
    `{"op":"add","path":"/elements/pump-m-new","value":{"type":"Metric","props":{"label":"New Tokens","value":"${snapshot.newTokens.length}","format":"number"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-m-mig","value":{"type":"Metric","props":{"label":"Migrations","value":"${snapshot.migrations.length}","format":"number"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-m-sol","value":{"type":"Metric","props":{"label":"Observed SOL Volume","value":"${esc(formatSolCompact(totalSolVolume))}","format":"number","change":"${esc(`Buys ${buyTrades.length} / Sells ${sellTrades.length}`)}"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-metrics-row","value":{"type":"Stack","props":{"gap":"md","direction":"horizontal"},"children":["pump-m-new","pump-m-mig","pump-m-sol"]}}`
  );

  // ── Notable launch alert ──
  const notableLaunches = snapshot.newTokens
    .filter((t) => (t.marketCapSol ?? 0) >= 150)
    .sort((a, b) => (b.marketCapSol ?? 0) - (a.marketCapSol ?? 0))
    .slice(0, 3);
  if (notableLaunches.length > 0) {
    const leaders = notableLaunches
      .map((t) => `${t.symbol}: ${formatSolCompact(t.marketCapSol)}`)
      .join(" | ");
    mainChildren.push("pump-launch-alert");
    push(
      `{"op":"add","path":"/elements/pump-launch-alert","value":{"type":"AlertBanner","props":{"title":"Notable Launches Detected","message":"${esc(leaders)}","severity":"alpha"},"children":[]}}`
    );
  }

  // ── New token launches ──
  if (snapshot.newTokens.length > 0) {
    mainChildren.push("pump-div-new", "pump-h-new");
    push(
      `{"op":"add","path":"/elements/pump-div-new","value":{"type":"Divider","props":{"label":"Live Launches"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/pump-h-new","value":{"type":"Heading","props":{"text":"Latest Token Creations","size":"sm"},"children":[]}}`
    );

    snapshot.newTokens.slice(0, 12).forEach((token, i) => {
      const key = `pump-token-${i}`;
      const tokenPrice = token.marketCapSol != null
        ? `${formatSolCompact(token.marketCapSol)} MCAP`
        : formatSolCompact(token.solAmount);
      const change = token.txType ? `"${esc(token.txType.toUpperCase())}"` : "null";
      mainChildren.push(key);
      push(
        `{"op":"add","path":"/elements/${key}","value":{"type":"TokenRow","props":{"name":"${esc(token.name)}","symbol":"${esc(token.symbol.toUpperCase())}","imageUrl":null,"price":"${esc(tokenPrice)}","change":${change},"sparklineData":null,"rank":${i + 1}},"children":[]}}`
      );
    });
  } else {
    mainChildren.push("pump-no-launches");
    push(
      `{"op":"add","path":"/elements/pump-no-launches","value":{"type":"Text","props":{"content":"No new token launches were captured during the 4-second snapshot window."},"children":[]}}`
    );
    mainChildren.push("pump-no-launches-alert");
    push(
      `{"op":"add","path":"/elements/pump-no-launches-alert","value":{"type":"AlertBanner","props":{"title":"No Events Captured Yet","message":"PumpPortal is active but this capture window returned no launches. Retry in a few seconds for fresh flow.","severity":"warning"},"children":[]}}`
    );
  }

  // ── Trade-flow heat map ──
  if (snapshot.recentTrades.length > 0) {
    const flowBySymbol = new Map<string, { buy: number; sell: number; total: number }>();
    snapshot.recentTrades.forEach((trade) => {
      const symbol = (trade.symbol || "UNK").toUpperCase();
      const sol = trade.solAmount ?? 0;
      const bucket = flowBySymbol.get(symbol) ?? { buy: 0, sell: 0, total: 0 };
      if (trade.txType === "sell") bucket.sell += sol;
      else bucket.buy += sol;
      bucket.total += sol;
      flowBySymbol.set(symbol, bucket);
    });

    const maxTotal = Math.max(...Array.from(flowBySymbol.values()).map((v) => v.total), 1);
    const cells = Array.from(flowBySymbol.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 18)
      .map(([symbol, flow]) => {
        const gross = flow.buy + flow.sell;
        const flowPct = gross > 0 ? ((flow.buy - flow.sell) / gross) * 100 : 0;
        const weight = Math.max(1, Math.min(3, Math.round((flow.total / maxTotal) * 3)));
        return {
          label: symbol,
          value: Number(flowPct.toFixed(1)),
          weight,
        };
      });

    if (cells.length > 0) {
      mainChildren.push("pump-div-heat", "pump-h-heat", "pump-heat");
      push(
        `{"op":"add","path":"/elements/pump-div-heat","value":{"type":"Divider","props":{"label":"Trade Flow"},"children":[]}}`
      );
      push(
        `{"op":"add","path":"/elements/pump-h-heat","value":{"type":"Heading","props":{"text":"Buy vs Sell Pressure by Token","size":"sm"},"children":[]}}`
      );
      push(
        `{"op":"add","path":"/elements/pump-heat","value":{"type":"HeatMap","props":{"cells":${JSON.stringify(cells)},"columns":6},"children":[]}}`
      );
    }
  }

  // ── Recent migrations table ──
  if (snapshot.migrations.length > 0) {
    mainChildren.push("pump-div-mig", "pump-mig-table");
    push(
      `{"op":"add","path":"/elements/pump-div-mig","value":{"type":"Divider","props":{"label":"Migrations"},"children":[]}}`
    );

    const columns = ["Token", "Mint", "Curve", "Time"];
    const rows = snapshot.migrations.slice(0, 10).map((m) => [
      `${m.symbol.toUpperCase()} (${m.name})`,
      `${m.mint.slice(0, 4)}...${m.mint.slice(-4)}`,
      m.bondingCurveKey
        ? `${m.bondingCurveKey.slice(0, 4)}...${m.bondingCurveKey.slice(-4)}`
        : "-",
      formatPumpTimestamp(m.timestamp),
    ]);
    push(
      `{"op":"add","path":"/elements/pump-mig-table","value":{"type":"Table","props":{"columns":${JSON.stringify(columns)},"rows":${JSON.stringify(rows.map((r) => r.map((c) => esc(c))))}},"children":[]}}`
    );
  }

  // ── Analysis summary + copy-ready recap ──
  mainChildren.push("pump-summary-text", "pump-share-alert");
  const netFlowTxt =
    netFlow > 0
      ? `Net buy pressure ${formatSolCompact(netFlow)}`
      : netFlow < 0
        ? `Net sell pressure ${formatSolCompact(Math.abs(netFlow))}`
        : "Buy/sell flow balanced";
  const summary = `Snapshot ${snapshot.timestamp}. Captured ${snapshot.newTokens.length} launches, ${snapshot.recentTrades.length} trades, and ${snapshot.migrations.length} migrations. ${netFlowTxt}.`;
  push(
    `{"op":"add","path":"/elements/pump-summary-text","value":{"type":"Text","props":{"content":"${esc(summary)}"},"children":[]}}`
  );
  const leadToken = snapshot.newTokens
    .slice()
    .sort((a, b) => (b.marketCapSol ?? 0) - (a.marketCapSol ?? 0))[0];
  const recapLine = [
    `${snapshot.newTokens.length} launches in 4s`,
    `${snapshot.migrations.length} migrations`,
    `${formatSolCompact(totalSolVolume)} flow`,
    leadToken ? `top launch ${leadToken.symbol.toUpperCase()} at ${formatSolCompact(leadToken.marketCapSol)}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
  const videoPromptTemplate = buildPumpVideoPromptTemplate(snapshot, prompt);
  const mediaPrompt = encodeURIComponent(prompt || "PumpPortal memecoin snapshot");
  const mediaVideoUrl = `/api/pump/media?format=video&prompt=${mediaPrompt}`;
  const mediaShotsUrl = `/api/pump/media?format=screenshots&prompt=${mediaPrompt}`;
  const mediaPromptsUrl = `/api/pump/media?format=prompts&prompt=${mediaPrompt}`;
  push(
    `{"op":"add","path":"/elements/pump-share-alert","value":{"type":"AlertBanner","props":{"title":"Share-Ready Recap","message":"${esc(recapLine)}","severity":"info"},"children":[]}}`
  );

  // ── Buttons ──
  mainChildren.push("pump-btns-row");
  push(
    `{"op":"add","path":"/elements/pump-btn-copy","value":{"type":"Button","props":{"label":"Copy Recap","action":"copy","params":{"text":"${esc(recapLine)}"}},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-btn-copy-video","value":{"type":"Button","props":{"label":"Copy Video Prompt","action":"copy","params":{"text":"${esc(videoPromptTemplate)}"}},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-btn-media-video","value":{"type":"Button","props":{"label":"Video Spec JSON","action":"navigate","params":{"url":"${esc(mediaVideoUrl)}"}},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-btn-media-shots","value":{"type":"Button","props":{"label":"Screenshot Plan","action":"navigate","params":{"url":"${esc(mediaShotsUrl)}"}},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-btn-media-prompts","value":{"type":"Button","props":{"label":"Prompt Pack","action":"navigate","params":{"url":"${esc(mediaPromptsUrl)}"}},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-btn-portal","value":{"type":"Button","props":{"label":"Open PumpPortal","action":"navigate","params":{"url":"https://pumpportal.fun"}},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-btn-pf","value":{"type":"Button","props":{"label":"Open pump.fun","action":"navigate","params":{"url":"https://pump.fun"}},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-btn-swap","value":{"type":"Button","props":{"label":"Open PumpSwap","action":"navigate","params":{"url":"https://pump.fun/swap"}},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-btns-row","value":{"type":"Stack","props":{"gap":"sm","direction":"horizontal"},"children":["pump-btn-copy","pump-btn-copy-video","pump-btn-media-video","pump-btn-media-shots","pump-btn-media-prompts","pump-btn-portal","pump-btn-pf","pump-btn-swap"]}}`
  );

  // ── Wrap with GlowCard and assemble ──
  push(
    `{"op":"add","path":"/elements/pump-main-stack","value":{"type":"Stack","props":{"gap":"lg","direction":"vertical"},"children":${JSON.stringify(mainChildren)}}}`
  );
  push(
    `{"op":"add","path":"/elements/pump-glow","value":{"type":"GlowCard","props":{"intensity":"medium"},"children":["pump-main-stack"]}}`
  );

  const title = prompt
    ? prompt.length > 56
      ? `${prompt.slice(0, 53)}...`
      : prompt
    : "PumpPortal Memecoin Snapshot";
  push(
    `{"op":"add","path":"/elements/card-main","value":{"type":"Card","props":{"title":"${esc(title)}","description":"Real-time stream: pump.fun, LetsBonk.fun, PumpSwap"},"children":["pump-glow"]}}`
  );

  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════
// SPEC BUILDER: Prediction Markets (Polymarket real data)
// ══════════════════════════════════════════════════════════════════
function buildPolymarketSpec(
  markets: PredictionMarket[],
  prompt: string
): string {
  const lines: string[] = [];
  const push = (line: string) => lines.push(line);

  push(`{"op":"add","path":"/root","value":"card-main"}`);

  const mainChildren: string[] = [];

  // ── Summary metrics ──
  mainChildren.push("summary-row");
  const totalVolume = markets.reduce((s, m) => s + (m.volume ?? 0), 0);
  const totalLiquidity = markets.reduce((s, m) => s + (m.liquidity ?? 0), 0);
  const avgYes =
    markets.length > 0
      ? markets.reduce((s, m) => s + m.yesPrice, 0) / markets.length
      : 0;

  push(
    `{"op":"add","path":"/elements/pm-count","value":{"type":"Metric","props":{"label":"Markets Found","value":"${markets.length}","format":"number"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pm-vol","value":{"type":"Metric","props":{"label":"Total Volume","value":"${esc(formatUsd(totalVolume))}","format":"currency"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/pm-liq","value":{"type":"Metric","props":{"label":"Total Liquidity","value":"${esc(formatUsd(totalLiquidity))}","format":"currency"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/summary-row","value":{"type":"Stack","props":{"gap":"md","direction":"horizontal"},"children":["pm-count","pm-vol","pm-liq"]}}`
  );

  // ── Markets table ──
  if (markets.length > 0) {
    mainChildren.push("div-markets", "markets-table");
    push(
      `{"op":"add","path":"/elements/div-markets","value":{"type":"Divider","props":{"label":"Active Markets"},"children":[]}}`
    );

    const cols = ["Question", "YES", "NO", "Volume", "Liquidity"];
    const rows = markets.slice(0, 15).map((m) => {
      const question =
        m.question.length > 60
          ? m.question.slice(0, 57) + "..."
          : m.question;
      return [
        question,
        `${(m.yesPrice * 100).toFixed(1)}%`,
        `${(m.noPrice * 100).toFixed(1)}%`,
        m.volume ? formatUsd(m.volume) : "-",
        m.liquidity ? formatUsd(m.liquidity) : "-",
      ];
    });

    push(
      `{"op":"add","path":"/elements/markets-table","value":{"type":"Table","props":{"columns":${JSON.stringify(cols)},"rows":${JSON.stringify(rows.map((r) => r.map((c) => esc(c))))}},"children":[]}}`
    );

    // ── Top 5 markets with probability bars ──
    mainChildren.push("div-probs", "prob-heading");
    push(
      `{"op":"add","path":"/elements/div-probs","value":{"type":"Divider","props":{"label":"Probability Breakdown"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/prob-heading","value":{"type":"Heading","props":{"text":"Top Markets by Volume","size":"sm"},"children":[]}}`
    );

    const sortedByVol = [...markets]
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, 6);

    sortedByVol.forEach((m, i) => {
      const key = `prob-${i}`;
      const wrapKey = `prob-wrap-${i}`;
      const textKey = `prob-q-${i}`;
      mainChildren.push(wrapKey);

      const shortQ =
        m.question.length > 70
          ? m.question.slice(0, 67) + "..."
          : m.question;
      const yesPct = Math.round(m.yesPrice * 100);

      push(
        `{"op":"add","path":"/elements/${textKey}","value":{"type":"Text","props":{"content":"${esc(shortQ)}"},"children":[]}}`
      );
      push(
        `{"op":"add","path":"/elements/${key}","value":{"type":"ProgressBar","props":{"label":"YES probability","value":${yesPct},"max":100,"color":"${yesPct >= 60 ? "emerald" : yesPct <= 40 ? "red" : "amber"}"},"children":[]}}`
      );
      push(
        `{"op":"add","path":"/elements/${wrapKey}","value":{"type":"Stack","props":{"gap":"sm","direction":"vertical"},"children":["${textKey}","${key}"]}}`
      );
    });
  }

  // ── Buttons ──
  mainChildren.push("btns-row");
  push(
    `{"op":"add","path":"/elements/btn-poly","value":{"type":"Button","props":{"label":"Open Polymarket","action":"navigate","params":{"url":"https://polymarket.com"}},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/btns-row","value":{"type":"Stack","props":{"gap":"sm","direction":"horizontal"},"children":["btn-poly"]}}`
  );

  // ── Assemble ──
  const title = prompt
    ? prompt.length > 50
      ? prompt.slice(0, 47) + "..."
      : prompt
    : "Prediction Markets";
  push(
    `{"op":"add","path":"/elements/main-stack","value":{"type":"Stack","props":{"gap":"lg","direction":"vertical"},"children":${JSON.stringify(mainChildren)}}}`
  );
  push(
    `{"op":"add","path":"/elements/card-main","value":{"type":"Card","props":{"title":"${esc(title)}","description":"Live data from Polymarket"},"children":["main-stack"]}}`
  );

  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════
// SPEC BUILDER: Arbitrage Dashboard (Polymarket × Manifold real data)
// ══════════════════════════════════════════════════════════════════
function buildArbitrageSpec(
  opportunities: ArbitrageOpportunity[],
  polyCount: number,
  manifoldCount: number,
  prompt: string
): string {
  const lines: string[] = [];
  const push = (line: string) => lines.push(line);

  push(`{"op":"add","path":"/root","value":"card-main"}`);

  const mainChildren: string[] = [];

  // ── Summary metrics ──
  mainChildren.push("summary-row");
  push(
    `{"op":"add","path":"/elements/sm-scanned","value":{"type":"Metric","props":{"label":"Markets Scanned","value":"${polyCount + manifoldCount}","format":"number","change":"${polyCount} Poly + ${manifoldCount} Manifold"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/sm-found","value":{"type":"Metric","props":{"label":"Opportunities Found","value":"${opportunities.length}","format":"number"},"children":[]}}`
  );

  const bestProfit = opportunities.length > 0 ? opportunities[0].impliedProfit ?? 0 : 0;
  const profitStr = bestProfit > 0 ? `+${(bestProfit * 100).toFixed(2)}%` : "0%";
  push(
    `{"op":"add","path":"/elements/sm-best","value":{"type":"Metric","props":{"label":"Best Edge","value":"${esc(profitStr)}","format":"percent"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/summary-row","value":{"type":"Stack","props":{"gap":"md","direction":"horizontal"},"children":["sm-scanned","sm-found","sm-best"]}}`
  );

  // ── How it works ──
  mainChildren.push("how-text");
  push(
    `{"op":"add","path":"/elements/how-text","value":{"type":"Text","props":{"content":"${esc("Cross-platform arbitrage: finds the same question on Polymarket and Manifold priced differently. Buy YES on the cheaper platform and NO on the other. If the total cost < $1, the difference is risk-free profit.")}"}, "children":[]}}`
  );

  if (opportunities.length === 0) {
    mainChildren.push("no-arb-text");
    push(
      `{"op":"add","path":"/elements/no-arb-text","value":{"type":"Text","props":{"content":"${esc("No significant arbitrage opportunities found right now. Markets are efficiently priced within the similarity threshold. Try again later — opportunities appear when news breaks and platforms react at different speeds.")}"}, "children":[]}}`
    );
  } else {
    // ── Opportunities table ──
    mainChildren.push("div-opps", "opps-table");
    push(
      `{"op":"add","path":"/elements/div-opps","value":{"type":"Divider","props":{"label":"Arbitrage Opportunities"},"children":[]}}`
    );

    const cols = ["Question", "Poly YES", "Manifold YES", "Spread", "Edge"];
    const rows = opportunities.slice(0, 12).map((opp) => {
      const poly = opp.markets.find((m) => m.platform === "polymarket");
      const mani = opp.markets.find((m) => m.platform === "manifold");
      const q = opp.question.length > 50 ? opp.question.slice(0, 47) + "..." : opp.question;
      const polyYes = poly ? `${(poly.yesPrice * 100).toFixed(1)}%` : "-";
      const maniYes = mani ? `${(mani.yesPrice * 100).toFixed(1)}%` : "-";
      const spread = opp.yesSpread != null
        ? `${opp.yesSpread > 0 ? "+" : ""}${(opp.yesSpread * 100).toFixed(1)}%`
        : "-";
      const edge = opp.impliedProfit != null && opp.impliedProfit > 0
        ? `+${(opp.impliedProfit * 100).toFixed(2)}%`
        : "-";
      return [q, polyYes, maniYes, spread, edge];
    });

    push(
      `{"op":"add","path":"/elements/opps-table","value":{"type":"Table","props":{"columns":${JSON.stringify(cols)},"rows":${JSON.stringify(rows.map((r) => r.map((c) => esc(c))))}},"children":[]}}`
    );

    // ── Detailed breakdown of top opportunities ──
    const topOpps = opportunities.filter((o) => (o.impliedProfit ?? 0) > 0).slice(0, 5);
    if (topOpps.length > 0) {
      mainChildren.push("div-detail", "detail-heading");
      push(
        `{"op":"add","path":"/elements/div-detail","value":{"type":"Divider","props":{"label":"Top Plays"},"children":[]}}`
      );
      push(
        `{"op":"add","path":"/elements/detail-heading","value":{"type":"Heading","props":{"text":"Opportunities with Positive Edge","size":"sm"},"children":[]}}`
      );

      topOpps.forEach((opp, i) => {
        const wrapKey = `arb-detail-${i}`;
        const qKey = `arb-q-${i}`;
        const barKey = `arb-bar-${i}`;
        const infoKey = `arb-info-${i}`;
        const badgeRow = `arb-badges-${i}`;
        mainChildren.push(wrapKey);

        const poly = opp.markets.find((m) => m.platform === "polymarket");
        const mani = opp.markets.find((m) => m.platform === "manifold");
        const profitPct = ((opp.impliedProfit ?? 0) * 100).toFixed(2);

        const shortQ = opp.question.length > 80 ? opp.question.slice(0, 77) + "..." : opp.question;

        push(
          `{"op":"add","path":"/elements/${qKey}","value":{"type":"Text","props":{"content":"${esc(shortQ)}"},"children":[]}}`
        );

        // Badges showing the play
        const buyYesPlatform = opp.bestYesBuy?.market.platform === "polymarket" ? "Polymarket" : "Manifold";
        const buyNoPlatform = opp.bestNoBuy?.market.platform === "polymarket" ? "Polymarket" : "Manifold";
        const yesPrice = opp.bestYesBuy ? `${(opp.bestYesBuy.price * 100).toFixed(1)}¢` : "?";
        const noPrice = opp.bestNoBuy ? `${(opp.bestNoBuy.price * 100).toFixed(1)}¢` : "?";

        push(
          `{"op":"add","path":"/elements/arb-b1-${i}","value":{"type":"Badge","props":{"label":"Buy YES on ${esc(buyYesPlatform)} @ ${esc(yesPrice)}","variant":"success"},"children":[]}}`
        );
        push(
          `{"op":"add","path":"/elements/arb-b2-${i}","value":{"type":"Badge","props":{"label":"Buy NO on ${esc(buyNoPlatform)} @ ${esc(noPrice)}","variant":"info"},"children":[]}}`
        );
        push(
          `{"op":"add","path":"/elements/arb-b3-${i}","value":{"type":"Badge","props":{"label":"+${esc(profitPct)}% edge","variant":"warning"},"children":[]}}`
        );
        push(
          `{"op":"add","path":"/elements/${badgeRow}","value":{"type":"Stack","props":{"gap":"sm","direction":"horizontal"},"children":["arb-b1-${i}","arb-b2-${i}","arb-b3-${i}"]}}`
        );

        // Progress bar showing how confident the YES side is on each platform
        const polyYesPct = poly ? Math.round(poly.yesPrice * 100) : 50;
        const maniYesPct = mani ? Math.round(mani.yesPrice * 100) : 50;
        push(
          `{"op":"add","path":"/elements/arb-pbar-poly-${i}","value":{"type":"ProgressBar","props":{"label":"Polymarket YES","value":${polyYesPct},"max":100,"color":"cyan"},"children":[]}}`
        );
        push(
          `{"op":"add","path":"/elements/arb-pbar-mani-${i}","value":{"type":"ProgressBar","props":{"label":"Manifold YES","value":${maniYesPct},"max":100,"color":"violet"},"children":[]}}`
        );

        push(
          `{"op":"add","path":"/elements/${wrapKey}","value":{"type":"Stack","props":{"gap":"sm","direction":"vertical"},"children":["${qKey}","${badgeRow}","arb-pbar-poly-${i}","arb-pbar-mani-${i}"]}}`
        );
      });
    }

    // ── Spread distribution bar chart ──
    if (opportunities.length >= 3) {
      mainChildren.push("div-spreads", "spread-bars");
      push(
        `{"op":"add","path":"/elements/div-spreads","value":{"type":"Divider","props":{"label":"Spread Distribution"},"children":[]}}`
      );
      const spreadBars = opportunities.slice(0, 8).map((opp, i) => {
        const shortQ = opp.question.length > 25 ? opp.question.slice(0, 22) + "..." : opp.question;
        const spreadVal = Math.round(Math.abs(opp.yesSpread ?? 0) * 1000) / 10; // as percentage
        const colors = ["emerald", "cyan", "amber", "violet", "red", "emerald", "cyan", "amber"];
        return `{"label":"${esc(shortQ)}","value":${spreadVal},"color":"${colors[i]}"}`;
      });
      push(
        `{"op":"add","path":"/elements/spread-bars","value":{"type":"BarChart","props":{"bars":[${spreadBars.join(",")}]},"children":[]}}`
      );
    }
  }

  // ── Buttons ──
  mainChildren.push("btns-row");
  push(
    `{"op":"add","path":"/elements/btn-poly","value":{"type":"Button","props":{"label":"Open Polymarket","action":"navigate","params":{"url":"https://polymarket.com"}},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/btn-mani","value":{"type":"Button","props":{"label":"Open Manifold","action":"navigate","params":{"url":"https://manifold.markets"}},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/btns-row","value":{"type":"Stack","props":{"gap":"sm","direction":"horizontal"},"children":["btn-poly","btn-mani"]}}`
  );

  // ── Assemble ──
  const title = prompt.length > 50 ? prompt.slice(0, 47) + "..." : prompt || "Arbitrage Scanner";
  push(
    `{"op":"add","path":"/elements/main-stack","value":{"type":"Stack","props":{"gap":"lg","direction":"vertical"},"children":${JSON.stringify(mainChildren)}}}`
  );
  push(
    `{"op":"add","path":"/elements/card-main","value":{"type":"Card","props":{"title":"${esc(title)}","description":"Cross-platform: Polymarket × Manifold"},"children":["main-stack"]}}`
  );

  return lines.join("\n");
}

// ── JSONL filter: strips non-JSONL lines from model output ──────
const STRUCTURED_FALLBACK_SPEC = [
  '{"op":"add","path":"/root","value":"fallback-card"}',
  '{"op":"add","path":"/elements/fallback-title","value":{"type":"Heading","props":{"text":"Recovered Structured Output","size":"sm"},"children":[]}}',
  '{"op":"add","path":"/elements/fallback-divider","value":{"type":"Divider","props":{"label":"SpecStream Recovery"},"children":[]}}',
  '{"op":"add","path":"/elements/fallback-text","value":{"type":"Text","props":{"content":"The model response was not valid SpecStream JSONL. Re-run this prompt to regenerate a richer dashboard."},"children":[]}}',
  '{"op":"add","path":"/elements/fallback-btn","value":{"type":"Button","props":{"label":"Retry Generation","action":"copy","params":{"text":"Regenerate the dashboard using valid SpecStream JSONL only."}},"children":[]}}',
  '{"op":"add","path":"/elements/fallback-main","value":{"type":"Stack","props":{"gap":"sm","direction":"vertical"},"children":["fallback-title","fallback-divider","fallback-text","fallback-btn"]}}',
  '{"op":"add","path":"/elements/fallback-card","value":{"type":"Card","props":{"title":"Structured UI Fallback","description":"Recovered from unstructured model output"},"children":["fallback-main"]}}',
].join("\n");

function extractJsonObjectsFromText(input: string): { objects: string[]; rest: string } {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (start === -1) {
      if (ch === "{") {
        start = i;
        depth = 1;
        inString = false;
        escape = false;
      }
      continue;
    }

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        objects.push(input.slice(start, i + 1));
        start = -1;
      }
      continue;
    }
  }

  return {
    objects,
    rest: start >= 0 ? input.slice(start) : "",
  };
}

function createJsonlFilterStream(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let emittedPatchCount = 0;
  let rootKey: string | null = null;
  let firstElementKey: string | null = null;
  let rootResolved = false;
  let rootRepaired = false;
  const elementKeys = new Set<string>();
  const LINE_DELAY_MS = 2;

  const delay = () => new Promise((resolve) => setTimeout(resolve, LINE_DELAY_MS));
  const emitLine = async (
    controller: TransformStreamDefaultController<Uint8Array>,
    line: string
  ) => {
    controller.enqueue(encoder.encode(line + "\n"));
    await delay();
  };

  const maybeRepairRoot = async (
    controller: TransformStreamDefaultController<Uint8Array>,
    force = false
  ) => {
    if (rootRepaired || !rootKey || !firstElementKey) return;
    if (elementKeys.has(rootKey)) {
      rootResolved = true;
      return;
    }

    const normalized = rootKey.trim().toLowerCase();
    const looksPlaceholder =
      normalized === "root" ||
      normalized === "rootkey" ||
      normalized.startsWith("root-") ||
      normalized.includes("dashboard") ||
      normalized.includes("overview");

    if (!force && !looksPlaceholder) return;

    const repairPatch = JSON.stringify({
      op: "replace",
      path: "/root",
      value: firstElementKey,
    });
    emittedPatchCount += 1;
    await emitLine(controller, repairPatch);
    rootKey = firstElementKey;
    rootResolved = true;
    rootRepaired = true;
  };

  const processText = async (
    text: string,
    controller: TransformStreamDefaultController<Uint8Array>
  ) => {
    if (!text) return;
    buffer += text;
    const { objects, rest } = extractJsonObjectsFromText(buffer);
    buffer = rest;
    for (const objectText of objects) {
      const trimmed = objectText.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof parsed.op === "string" &&
          typeof parsed.path === "string"
        ) {
          if (parsed.path === "/root" && typeof parsed.value === "string") {
            rootKey = parsed.value;
            rootResolved = elementKeys.has(parsed.value);
          }
          if (parsed.path.startsWith("/elements/")) {
            const key = parsed.path.slice("/elements/".length).split("/")[0];
            if (key) {
              if (!firstElementKey) firstElementKey = key;
              elementKeys.add(key);
              if (rootKey && key === rootKey) rootResolved = true;
            }
          }
          emittedPatchCount += 1;
          await emitLine(controller, trimmed);
          if (!rootResolved) {
            await maybeRepairRoot(controller, false);
          }
        }
      } catch {
        // skip invalid JSON chunks
      }
    }
  };

  return new TransformStream({
    async transform(chunk, controller) {
      await processText(decoder.decode(chunk, { stream: true }), controller);
    },
    async flush(controller) {
      await processText(decoder.decode(), controller);

      // Try one final parse for any remaining complete object.
      const trailing = buffer.trim();
      if (trailing.startsWith("{") && trailing.endsWith("}")) {
        try {
          const parsed = JSON.parse(trailing);
          if (
            parsed &&
            typeof parsed === "object" &&
            typeof parsed.op === "string" &&
            typeof parsed.path === "string"
          ) {
            if (parsed.path === "/root" && typeof parsed.value === "string") {
              rootKey = parsed.value;
              rootResolved = elementKeys.has(parsed.value);
            }
            if (parsed.path.startsWith("/elements/")) {
              const key = parsed.path.slice("/elements/".length).split("/")[0];
              if (key) {
                if (!firstElementKey) firstElementKey = key;
                elementKeys.add(key);
                if (rootKey && key === rootKey) rootResolved = true;
              }
            }
            emittedPatchCount += 1;
            await emitLine(controller, trailing);
          }
        } catch {
          // ignore trailing parse errors
        }
      }

      if (!rootResolved) {
        await maybeRepairRoot(controller, true);
      }

      if (emittedPatchCount === 0) {
        const lines = STRUCTURED_FALLBACK_SPEC.split("\n").filter(Boolean);
        for (const line of lines) {
          await emitLine(controller, line);
        }
      }
    },
  });
}

// ── System prompt (only for general/fallback queries) ───────────
function buildSystemPrompt(
  dataContext: string,
  currentTree?: unknown
): string {
  return `You are an expert crypto market analyst. You respond ONLY with valid SpecStream JSONL — no prose, no markdown, no explanations.

CRITICAL: You MUST ONLY use numbers, prices, and data from the REAL DATA CONTEXT below. Do NOT make up, hallucinate, or estimate any prices, volumes, percentages, or market data. If you don't have data for something, say "Data unavailable" — NEVER fabricate numbers.

# Component Catalog (ALL available components)

- Card: title (string), description (string|null). Section container with children.
- Button: label (string), action (string|null), params (object|null). Call-to-action.
- Text: content (string). Analysis text, keep it factual and punchy.
- Heading: text (string), size ("sm"|"md"|"lg"|null). Section headers.
- Stack: gap ("sm"|"md"|"lg"), direction ("vertical"|"horizontal"). Layout container.
- Metric: label (string), value (string), format ("currency"|"percent"|"number"|null), change (string|null). Key data points. Prefix change with + or - for color.
- Badge: label (string), variant ("default"|"success"|"warning"|"danger"|"info"|null). Colored status tag.
- Divider: label (string|null). Horizontal separator with optional centered label.
- Table: columns (string[]), rows (string[][]). Data table. First column is bold, +/- values auto-color.
- ProgressBar: label (string), value (number), max (number|null, default 100), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null).
- SparkLine: data (number[]), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), height (number|null). SVG sparkline chart.
- BarChart: bars ({label: string, value: number, color: string|null}[]). Horizontal bar chart.
- DonutChart: segments ({label: string, value: number, color: string|null}[]), size (number|null). Ring/donut chart.
- Image: src (string), alt (string), width (number|null), height (number|null), rounded ("none"|"md"|"full"|null). Coin logos, avatars.
- TokenRow: name (string), symbol (string), imageUrl (string|null), price (string), change (string|null), sparklineData (number[]|null), rank (number|null). Compact token strip with logo + sparkline + price.
- HeatMap: cells ({label: string, value: number, weight: number|null}[]), columns (number|null). Red→green colored grid.
- ScoreRing: score (0-100 number), label (string), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), size ("sm"|"md"|"lg"|null). Animated circular gauge.
- GlowCard: intensity ("low"|"medium"|"high"|null). Animated breathing glow wrapper. Has children slot.
- DivergenceBar: leftLabel (string), leftValue (number), rightLabel (string), rightValue (number), maxValue (number|null). Two-sided bar for signal disagreement.
- AlertBanner: title (string), message (string), severity ("alpha"|"warning"|"critical"|"info"|null). Eye-catching notification with pulse.
- RadarChart: axes ({label: string, value: number, max: number|null}[]), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), size (number|null). Spider/radar chart.

# Output Format — STRICT
- ONLY output valid JSONL. One JSON object per line. Nothing else.
- Each line: {"op":"add","path":"/elements/KEY","value":{...}}
- First line MUST be: {"op":"add","path":"/root","value":"card-main"}
- The root value MUST match an actual element key you add (for example, /root = "card-main" and then /elements/card-main ...).
- Keys: card-main, card-1, text-1, metric-1, stack-1, etc.
- Every element needs: type, props, children (array of child keys, or [])
- Do NOT wrap in code blocks. No text before or after.

# Layout Guidelines
- Start with a Card as root
- Lead with 3-4 Metric components in a horizontal Stack
- Use Divider with labels to separate sections
- Use Tables for data comparisons
- Use SparkLine for price trends (pass array of numbers)
- Use BarChart for volume/TVL comparisons
- Use DonutChart for market share/allocation breakdowns
- Use ProgressBar for probability/percentage visualization
- Use Badge for status tags (bullish=success, bearish=danger, neutral=warning)
- End with Button(s) for external links
- Keep Text content factual, data-driven, no fluff

REAL DATA CONTEXT (USE ONLY THESE NUMBERS):
${dataContext}

${currentTree ? `\nCurrent dashboard state:\n${JSON.stringify(currentTree, null, 2)}` : ""}`;
}

// ── Serialize CoinGecko data for LLM context ────────────────────
function serializeMarketDataForLLM(
  coins: CoinMarketData[],
  globalData: GlobalData | null,
  trending: TrendingCoinItem[],
  prompt: string
): string {
  const parts: string[] = [];
  parts.push(`User asked: "${prompt}"`);

  if (globalData) {
    parts.push(`\nGLOBAL MARKET DATA:`);
    parts.push(`  Total Market Cap: ${formatUsd(globalData.total_market_cap?.usd ?? 0)}`);
    parts.push(`  24h Volume: ${formatUsd(globalData.total_volume?.usd ?? 0)}`);
    parts.push(`  24h Market Cap Change: ${formatPct(globalData.market_cap_change_percentage_24h_usd)}`);
    parts.push(`  BTC Dominance: ${(globalData.market_cap_percentage?.btc ?? 0).toFixed(1)}%`);
    parts.push(`  ETH Dominance: ${(globalData.market_cap_percentage?.eth ?? 0).toFixed(1)}%`);
  }

  if (coins.length > 0) {
    parts.push(`\nCOIN DATA (${coins.length} coins):`);
    coins.forEach((c) => {
      const sparkInfo = c.sparkline_in_7d?.price?.length
        ? ` | 7d sparkline: [${downsample(c.sparkline_in_7d.price, 20).map((v) => v.toFixed(2)).join(",")}]`
        : "";
      parts.push(
        `  ${c.name} (${c.symbol.toUpperCase()}) #${c.market_cap_rank ?? "?"}: Price=${formatUsd(c.current_price)} | 24h=${formatPct(c.price_change_percentage_24h)} | 7d=${formatPct(c.price_change_percentage_7d_in_currency)} | MCap=${formatUsd(c.market_cap)} | Vol=${formatUsd(c.total_volume)}${sparkInfo}`
      );
    });
  }

  if (trending.length > 0) {
    parts.push(`\nTRENDING (by search activity): ${trending.slice(0, 8).map((t) => `${t.name} (${t.symbol.toUpperCase()}) #${t.market_cap_rank ?? "?"}`).join(", ")}`);
  }

  return parts.join("\n");
}

// ── Market system prompt (for hybrid PATH 3) ────────────────────
function buildMarketPrompt(dataContext: string): string {
  return `You are an expert crypto market analyst building custom visual dashboards. You respond ONLY with valid SpecStream JSONL — no prose, no markdown, no explanations.

CRITICAL RULES:
1. You MUST ONLY use data from the REAL MARKET DATA below. NEVER fabricate prices, volumes, market caps, or any numbers.
2. Build a CUSTOM dashboard tailored to what the user is asking about:
   - If asking about a specific coin: focus the dashboard on that coin with its price, charts, comparisons
   - If asking about market overview: show global metrics, top movers, dominance breakdown
   - If asking about trends: highlight biggest gainers/losers, trending coins
   - If asking about DeFi/sectors: group and compare relevant coins
3. VARY your layout based on the question. Don't always use the same template:
   - For specific coins: lead with Metrics, then SparkLine with real sparkline data, then comparison Table
   - For overview: lead with global Metrics, DonutChart for dominance, then top coins Table
   - For comparisons: use BarChart for volume/price comparison, Table side-by-side
   - For trends: lead with Badges for sentiment, then gainers/losers Tables
4. Use SparkLine ONLY when sparkline data arrays are provided in the data context
5. Include analytical Text that interprets the data — market sentiment, notable movements, what stands out
6. Add one short share-ready recap line (numbers only, no hype language) so users can post quickly.

# Component Catalog

- Card: title (string), description (string|null). Section container with children.
- Button: label (string), action (string|null), params (object|null). Call-to-action.
- Text: content (string). Analysis text, keep it factual and punchy.
- Heading: text (string), size ("sm"|"md"|"lg"|null). Section headers.
- Stack: gap ("sm"|"md"|"lg"), direction ("vertical"|"horizontal"). Layout container.
- Metric: label (string), value (string), format ("currency"|"percent"|"number"|null), change (string|null). Prefix change with + or - for color.
- Badge: label (string), variant ("default"|"success"|"warning"|"danger"|"info"|null). Colored status tag.
- Divider: label (string|null). Horizontal separator with optional centered label.
- Table: columns (string[]), rows (string[][]). First column is bold, +/- values auto-color.
- ProgressBar: label (string), value (number), max (number|null, default 100), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null).
- SparkLine: data (number[]), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), height (number|null). SVG sparkline. ONLY use with real number arrays from data context.
- BarChart: bars ({label: string, value: number, color: string|null}[]). Horizontal bar chart.
- DonutChart: segments ({label: string, value: number, color: string|null}[]), size (number|null). Ring chart.
- Image: src (string), alt (string), width (number|null), height (number|null), rounded ("none"|"md"|"full"|null). Coin logos, avatars.
- TokenRow: name (string), symbol (string), imageUrl (string|null), price (string), change (string|null), sparklineData (number[]|null), rank (number|null). Compact token strip with logo + sparkline + price.
- HeatMap: cells ({label: string, value: number, weight: number|null}[]), columns (number|null). Red→green colored grid.
- ScoreRing: score (0-100 number), label (string), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), size ("sm"|"md"|"lg"|null). Animated circular gauge.
- GlowCard: intensity ("low"|"medium"|"high"|null). Animated breathing glow wrapper. Has children slot.
- DivergenceBar: leftLabel (string), leftValue (number), rightLabel (string), rightValue (number), maxValue (number|null). Two-sided bar for signal disagreement.
- AlertBanner: title (string), message (string), severity ("alpha"|"warning"|"critical"|"info"|null). Eye-catching notification with pulse.
- RadarChart: axes ({label: string, value: number, max: number|null}[]), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), size (number|null). Spider/radar chart.

# Output Format — STRICT
- ONLY output valid JSONL. One JSON object per line. Nothing else.
- Each line: {"op":"add","path":"/elements/KEY","value":{...}}
- First line MUST be: {"op":"add","path":"/root","value":"card-main"}
- The root value MUST match an actual element key you add (for example, /root = "card-main" and then /elements/card-main ...).
- Keys: card-main, card-1, text-1, metric-1, stack-1, etc.
- Every element needs: type, props, children (array of child keys, or [])
- Do NOT wrap in code blocks. No text before or after.

REAL MARKET DATA (USE ONLY THESE NUMBERS):
${dataContext}`;
}

// ── PumpPortal system prompt (for pump fallback path) ───────────
function buildPumpPrompt(dataContext: string): string {
  return `You are a Solana memecoin flow analyst building custom visual dashboards. You respond ONLY with valid SpecStream JSONL — no prose, no markdown, no explanations.

CRITICAL RULES:
1. You MUST ONLY use data from the REAL PUMPPORTAL DATA below. NEVER fabricate launches, trades, migrations, or any numbers.
2. Focus on real-time signal quality:
   - New token launch velocity
   - Buy vs sell pressure (SOL flow)
   - Notable migration events
   - Outlier launches by market cap
3. Use these components in the layout:
   - GlowCard as the visual wrapper for the main body
   - ScoreRing for a single "pulse" score (0-100) based on launch/trade intensity
   - Metrics for launch count, migration count, and SOL volume
   - AlertBanner for notable launch/migration anomalies
   - TokenRow for launches
   - HeatMap for flow distribution
   - Table for migrations
4. Keep all text factual, concise, and data-driven.
5. Include one short "share-ready recap" line in an AlertBanner or Text (single sentence, no hype words, pure numbers).
6. Add one Button with action "copy" and params {"text":"<same recap line>"} for one-click sharing.
7. If data is missing, explicitly say "Data unavailable" instead of guessing.

# Component Catalog

- Card: title (string), description (string|null). Section container with children.
- Button: label (string), action (string|null), params (object|null). Call-to-action.
- Text: content (string). Analysis text, keep it factual and punchy.
- Heading: text (string), size ("sm"|"md"|"lg"|null). Section headers.
- Stack: gap ("sm"|"md"|"lg"), direction ("vertical"|"horizontal"). Layout container.
- Metric: label (string), value (string), format ("currency"|"percent"|"number"|null), change (string|null). Prefix change with + or - for color.
- Badge: label (string), variant ("default"|"success"|"warning"|"danger"|"info"|null). Colored status tag.
- Divider: label (string|null). Horizontal separator with optional centered label.
- Table: columns (string[]), rows (string[][]). First column is bold, +/- values auto-color.
- ProgressBar: label (string), value (number), max (number|null, default 100), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null).
- SparkLine: data (number[]), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), height (number|null). SVG sparkline.
- BarChart: bars ({label: string, value: number, color: string|null}[]). Horizontal bar chart.
- DonutChart: segments ({label: string, value: number, color: string|null}[]), size (number|null). Ring chart.
- Image: src (string), alt (string), width (number|null), height (number|null), rounded ("none"|"md"|"full"|null). Coin logos, avatars.
- TokenRow: name (string), symbol (string), imageUrl (string|null), price (string), change (string|null), sparklineData (number[]|null), rank (number|null). Compact token strip with logo + sparkline + price.
- HeatMap: cells ({label: string, value: number, weight: number|null}[]), columns (number|null). Red→green colored grid.
- ScoreRing: score (0-100 number), label (string), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), size ("sm"|"md"|"lg"|null). Animated circular gauge.
- GlowCard: intensity ("low"|"medium"|"high"|null). Animated breathing glow wrapper. Has children slot.
- DivergenceBar: leftLabel (string), leftValue (number), rightLabel (string), rightValue (number), maxValue (number|null). Two-sided bar for signal disagreement.
- AlertBanner: title (string), message (string), severity ("alpha"|"warning"|"critical"|"info"|null). Eye-catching notification with pulse.
- RadarChart: axes ({label: string, value: number, max: number|null}[]), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), size (number|null). Spider/radar chart.

# Output Format — STRICT
- ONLY output valid JSONL. One JSON object per line. Nothing else.
- Each line: {"op":"add","path":"/elements/KEY","value":{...}}
- First line MUST be: {"op":"add","path":"/root","value":"card-main"}
- The root value MUST match an actual element key you add (for example, /root = "card-main" and then /elements/card-main ...).
- Keys: card-main, card-1, text-1, metric-1, stack-1, etc.
- Every element needs: type, props, children (array of child keys, or [])
- Do NOT wrap in code blocks. No text before or after.

REAL PUMPPORTAL DATA (USE ONLY THESE NUMBERS):
${dataContext}`;
}

// ── Prediction market system prompt (for hybrid PATH 4) ─────────
function buildPredictionPrompt(dataContext: string): string {
  return `You are a prediction market analyst building custom visual dashboards. You respond ONLY with valid SpecStream JSONL — no prose, no markdown, no explanations.

CRITICAL RULES:
1. You MUST ONLY use data from the REAL POLYMARKET DATA below. NEVER fabricate questions, prices, volumes, or any numbers.
2. Build a CUSTOM dashboard tailored to what the user is asking about. Do NOT just dump all data in a table.
3. Be creative with the layout — use different component combinations depending on the query:
   - If asking about a specific topic (crypto, politics, sports): filter and show ONLY relevant markets
   - If asking about trending/popular: show top volume markets with visual comparisons
   - If asking about confidence/probability: highlight high-confidence and close-call markets
   - If asking for general overview: mix different categories with charts
4. VARY your layout. Don't always use the same components in the same order. Mix it up:
   - Sometimes lead with DonutChart for category breakdown
   - Sometimes lead with Metrics for key stats
   - Sometimes lead with a Table of matched markets
   - Use ProgressBars to compare probabilities
   - Use BarChart to compare volumes across markets
   - Use SparkLine ONLY if you have numeric time-series data arrays
   - Use Badges to tag market categories or confidence levels
5. Include analysis Text that interprets the data — what's the market sentiment? What are the closest calls? Where's the money flowing?

# Component Catalog (ALL available components)

- Card: title (string), description (string|null). Section container with children.
- Button: label (string), action (string|null), params (object|null). Call-to-action.
- Text: content (string). Analysis text, keep it factual and punchy.
- Heading: text (string), size ("sm"|"md"|"lg"|null). Section headers.
- Stack: gap ("sm"|"md"|"lg"), direction ("vertical"|"horizontal"). Layout container.
- Metric: label (string), value (string), format ("currency"|"percent"|"number"|null), change (string|null). Key data points. Prefix change with + or - for color.
- Badge: label (string), variant ("default"|"success"|"warning"|"danger"|"info"|null). Colored status tag.
- Divider: label (string|null). Horizontal separator with optional centered label.
- Table: columns (string[]), rows (string[][]). Data table. First column is bold, +/- values auto-color.
- ProgressBar: label (string), value (number), max (number|null, default 100), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null).
- SparkLine: data (number[]), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), height (number|null). SVG sparkline chart. ONLY use with real numeric arrays.
- BarChart: bars ({label: string, value: number, color: string|null}[]). Horizontal bar chart.
- DonutChart: segments ({label: string, value: number, color: string|null}[]), size (number|null). Ring/donut chart.
- Image: src (string), alt (string), width (number|null), height (number|null), rounded ("none"|"md"|"full"|null). Coin logos, avatars.
- TokenRow: name (string), symbol (string), imageUrl (string|null), price (string), change (string|null), sparklineData (number[]|null), rank (number|null). Compact token strip with logo + sparkline + price.
- HeatMap: cells ({label: string, value: number, weight: number|null}[]), columns (number|null). Red→green colored grid.
- ScoreRing: score (0-100 number), label (string), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), size ("sm"|"md"|"lg"|null). Animated circular gauge.
- GlowCard: intensity ("low"|"medium"|"high"|null). Animated breathing glow wrapper. Has children slot.
- DivergenceBar: leftLabel (string), leftValue (number), rightLabel (string), rightValue (number), maxValue (number|null). Two-sided bar for signal disagreement.
- AlertBanner: title (string), message (string), severity ("alpha"|"warning"|"critical"|"info"|null). Eye-catching notification with pulse.
- RadarChart: axes ({label: string, value: number, max: number|null}[]), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), size (number|null). Spider/radar chart.

# Output Format — STRICT
- ONLY output valid JSONL. One JSON object per line. Nothing else.
- Each line: {"op":"add","path":"/elements/KEY","value":{...}}
- First line MUST be: {"op":"add","path":"/root","value":"card-main"}
- The root value MUST match an actual element key you add (for example, /root = "card-main" and then /elements/card-main ...).
- Keys: card-main, card-1, text-1, metric-1, stack-1, etc.
- Every element needs: type, props, children (array of child keys, or [])
- Do NOT wrap in code blocks. No text before or after.

REAL POLYMARKET DATA (USE ONLY THESE NUMBERS):
${dataContext}`;
}

// ── Alpha system prompt (for hybrid PATH 6) ─────────────────────
function buildAlphaPrompt(dataContext: string): string {
  return `You are a cross-signal alpha analyst building custom visual dashboards. You respond ONLY with valid SpecStream JSONL — no prose, no markdown, no explanations.

CRITICAL RULES:
1. You MUST ONLY use data from the REAL ALPHA REPORT below. NEVER fabricate signals, prices, or any numbers.
2. Build a CUSTOM dashboard showing cross-signal intelligence that doesn't exist on any single platform.
3. Structure your dashboard to highlight:
   - Price-market divergences (where prediction markets disagree with crypto price trends)
   - Volume anomalies (unusual activity spikes in prediction markets)
   - Confidence clusters (multiple markets in same topic trending same direction)
   - Liquidity imbalances (high confidence but thin markets — potential edge)
4. VARY your layout:
   - Lead with key Metrics (total signals, biggest divergence, strongest cluster)
   - Use ProgressBars to compare market probability vs price-implied probability
   - Use BarChart for anomaly scores or divergence magnitudes
   - Use Badges for signal types (divergence=warning, anomaly=danger, cluster=info, imbalance=success)
   - Use Tables for detailed signal breakdowns
   - Use Text for analysis of what the signals mean together
5. Include actionable analysis — what should a trader pay attention to?

# Component Catalog

- Card: title (string), description (string|null). Section container with children.
- Button: label (string), action (string|null), params (object|null). Call-to-action.
- Text: content (string). Analysis text, keep it factual and punchy.
- Heading: text (string), size ("sm"|"md"|"lg"|null). Section headers.
- Stack: gap ("sm"|"md"|"lg"), direction ("vertical"|"horizontal"). Layout container.
- Metric: label (string), value (string), format ("currency"|"percent"|"number"|null), change (string|null). Prefix change with + or - for color.
- Badge: label (string), variant ("default"|"success"|"warning"|"danger"|"info"|null). Colored status tag.
- Divider: label (string|null). Horizontal separator with optional centered label.
- Table: columns (string[]), rows (string[][]). First column is bold, +/- values auto-color.
- ProgressBar: label (string), value (number), max (number|null, default 100), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null).
- SparkLine: data (number[]), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), height (number|null). SVG sparkline. ONLY use with real number arrays.
- BarChart: bars ({label: string, value: number, color: string|null}[]). Horizontal bar chart.
- DonutChart: segments ({label: string, value: number, color: string|null}[]), size (number|null). Ring chart.
- Image: src (string), alt (string), width (number|null), height (number|null), rounded ("none"|"md"|"full"|null). Coin logos, avatars.
- TokenRow: name (string), symbol (string), imageUrl (string|null), price (string), change (string|null), sparklineData (number[]|null), rank (number|null). Compact token strip with logo + sparkline + price.
- HeatMap: cells ({label: string, value: number, weight: number|null}[]), columns (number|null). Red→green colored grid.
- ScoreRing: score (0-100 number), label (string), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), size ("sm"|"md"|"lg"|null). Animated circular gauge.
- GlowCard: intensity ("low"|"medium"|"high"|null). Animated breathing glow wrapper. Has children slot.
- DivergenceBar: leftLabel (string), leftValue (number), rightLabel (string), rightValue (number), maxValue (number|null). Two-sided bar for signal disagreement.
- AlertBanner: title (string), message (string), severity ("alpha"|"warning"|"critical"|"info"|null). Eye-catching notification with pulse.
- RadarChart: axes ({label: string, value: number, max: number|null}[]), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), size (number|null). Spider/radar chart.

# Output Format — STRICT
- ONLY output valid JSONL. One JSON object per line. Nothing else.
- Each line: {"op":"add","path":"/elements/KEY","value":{...}}
- First line MUST be: {"op":"add","path":"/root","value":"card-main"}
- The root value MUST match an actual element key you add (for example, /root = "card-main" and then /elements/card-main ...).
- Keys: card-main, card-1, text-1, metric-1, stack-1, etc.
- Every element needs: type, props, children (array of child keys, or [])
- Do NOT wrap in code blocks. No text before or after.

REAL ALPHA REPORT (USE ONLY THESE NUMBERS):
${dataContext}`;
}

// ── Whale intelligence system prompt (for hybrid PATH 7) ────────
function buildWhalePrompt(dataContext: string): string {
  return `You are a whale intelligence analyst building custom visual dashboards. You respond ONLY with valid SpecStream JSONL — no prose, no markdown, no explanations.

CRITICAL RULES:
1. You MUST ONLY use data from the REAL WHALE REPORT below. NEVER fabricate wallet data, balances, or any numbers.
2. Build a CUSTOM deep-dive dashboard for this wallet showing:
   - Strategy classification with confidence scores
   - Portfolio concentration analysis (HHI, top holdings %)
   - Activity pattern (daily/weekly/monthly/dormant)
   - Risk rating with explanation
   - Prediction market cross-references (what markets relate to their holdings)
3. VARY your layout:
   - Lead with Badges for strategy type and risk rating
   - Use Metrics for key stats (SOL balance, token count, tx frequency)
   - Use DonutChart for portfolio concentration
   - Use BarChart for strategy confidence scores
   - Use ProgressBars for concentration percentages
   - Use Tables for prediction market cross-references
   - Use Text for analytical summary
4. Make the dashboard tell a story about this wallet's behavior and what it means

# Component Catalog

- Card: title (string), description (string|null). Section container with children.
- Button: label (string), action (string|null), params (object|null). Call-to-action.
- Text: content (string). Analysis text, keep it factual and punchy.
- Heading: text (string), size ("sm"|"md"|"lg"|null). Section headers.
- Stack: gap ("sm"|"md"|"lg"), direction ("vertical"|"horizontal"). Layout container.
- Metric: label (string), value (string), format ("currency"|"percent"|"number"|null), change (string|null). Prefix change with + or - for color.
- Badge: label (string), variant ("default"|"success"|"warning"|"danger"|"info"|null). Colored status tag.
- Divider: label (string|null). Horizontal separator with optional centered label.
- Table: columns (string[]), rows (string[][]). First column is bold, +/- values auto-color.
- ProgressBar: label (string), value (number), max (number|null, default 100), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null).
- SparkLine: data (number[]), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), height (number|null). SVG sparkline.
- BarChart: bars ({label: string, value: number, color: string|null}[]). Horizontal bar chart.
- DonutChart: segments ({label: string, value: number, color: string|null}[]), size (number|null). Ring chart.
- Image: src (string), alt (string), width (number|null), height (number|null), rounded ("none"|"md"|"full"|null). Coin logos, avatars.
- TokenRow: name (string), symbol (string), imageUrl (string|null), price (string), change (string|null), sparklineData (number[]|null), rank (number|null). Compact token strip with logo + sparkline + price.
- HeatMap: cells ({label: string, value: number, weight: number|null}[]), columns (number|null). Red→green colored grid.
- ScoreRing: score (0-100 number), label (string), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), size ("sm"|"md"|"lg"|null). Animated circular gauge.
- GlowCard: intensity ("low"|"medium"|"high"|null). Animated breathing glow wrapper. Has children slot.
- DivergenceBar: leftLabel (string), leftValue (number), rightLabel (string), rightValue (number), maxValue (number|null). Two-sided bar for signal disagreement.
- AlertBanner: title (string), message (string), severity ("alpha"|"warning"|"critical"|"info"|null). Eye-catching notification with pulse.
- RadarChart: axes ({label: string, value: number, max: number|null}[]), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), size (number|null). Spider/radar chart.

# Output Format — STRICT
- ONLY output valid JSONL. One JSON object per line. Nothing else.
- Each line: {"op":"add","path":"/elements/KEY","value":{...}}
- First line MUST be: {"op":"add","path":"/root","value":"card-main"}
- The root value MUST match an actual element key you add (for example, /root = "card-main" and then /elements/card-main ...).
- Keys: card-main, card-1, text-1, metric-1, stack-1, etc.
- Every element needs: type, props, children (array of child keys, or [])
- Do NOT wrap in code blocks. No text before or after.

REAL WHALE INTELLIGENCE REPORT (USE ONLY THESE NUMBERS):
${dataContext}`;
}

// ── Narrative engine system prompt (for hybrid PATH 8) ───────────
function buildNarrativePrompt(dataContext: string): string {
  return `You are a crypto narrative analyst building custom visual dashboards. You respond ONLY with valid SpecStream JSONL — no prose, no markdown, no explanations.

CRITICAL RULES:
1. You MUST ONLY use data from the REAL NARRATIVE REPORT below. NEVER fabricate themes, scores, or any numbers.
2. Build a CUSTOM dashboard mapping prediction market events to impacted tokens:
   - Show scored narratives ranked by composite score
   - For each narrative, show matched markets and impacted tokens
   - Highlight which tokens would benefit or suffer from each narrative
   - Show the confidence/momentum/volume breakdown
3. VARY your layout:
   - Lead with Metrics (total narratives, strongest theme, market coverage)
   - Use BarChart for composite scores comparison
   - Use ProgressBars for confidence levels per narrative
   - Use DonutChart for volume distribution across themes
   - Use Tables for token impact matrices
   - Use Badges for impact direction (positive=success, negative=danger, neutral=warning)
   - Use Text for connecting the dots between narratives
4. Help users understand: "If X happens in prediction markets, Y tokens will move"

# Component Catalog

- Card: title (string), description (string|null). Section container with children.
- Button: label (string), action (string|null), params (object|null). Call-to-action.
- Text: content (string). Analysis text, keep it factual and punchy.
- Heading: text (string), size ("sm"|"md"|"lg"|null). Section headers.
- Stack: gap ("sm"|"md"|"lg"), direction ("vertical"|"horizontal"). Layout container.
- Metric: label (string), value (string), format ("currency"|"percent"|"number"|null), change (string|null). Prefix change with + or - for color.
- Badge: label (string), variant ("default"|"success"|"warning"|"danger"|"info"|null). Colored status tag.
- Divider: label (string|null). Horizontal separator with optional centered label.
- Table: columns (string[]), rows (string[][]). First column is bold, +/- values auto-color.
- ProgressBar: label (string), value (number), max (number|null, default 100), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null).
- SparkLine: data (number[]), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), height (number|null). SVG sparkline.
- BarChart: bars ({label: string, value: number, color: string|null}[]). Horizontal bar chart.
- DonutChart: segments ({label: string, value: number, color: string|null}[]), size (number|null). Ring chart.
- Image: src (string), alt (string), width (number|null), height (number|null), rounded ("none"|"md"|"full"|null). Coin logos, avatars.
- TokenRow: name (string), symbol (string), imageUrl (string|null), price (string), change (string|null), sparklineData (number[]|null), rank (number|null). Compact token strip with logo + sparkline + price.
- HeatMap: cells ({label: string, value: number, weight: number|null}[]), columns (number|null). Red→green colored grid.
- ScoreRing: score (0-100 number), label (string), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), size ("sm"|"md"|"lg"|null). Animated circular gauge.
- GlowCard: intensity ("low"|"medium"|"high"|null). Animated breathing glow wrapper. Has children slot.
- DivergenceBar: leftLabel (string), leftValue (number), rightLabel (string), rightValue (number), maxValue (number|null). Two-sided bar for signal disagreement.
- AlertBanner: title (string), message (string), severity ("alpha"|"warning"|"critical"|"info"|null). Eye-catching notification with pulse.
- RadarChart: axes ({label: string, value: number, max: number|null}[]), color ("emerald"|"cyan"|"amber"|"red"|"violet"|null), size (number|null). Spider/radar chart.

# Output Format — STRICT
- ONLY output valid JSONL. One JSON object per line. Nothing else.
- Each line: {"op":"add","path":"/elements/KEY","value":{...}}
- First line MUST be: {"op":"add","path":"/root","value":"card-main"}
- The root value MUST match an actual element key you add (for example, /root = "card-main" and then /elements/card-main ...).
- Keys: card-main, card-1, text-1, metric-1, stack-1, etc.
- Every element needs: type, props, children (array of child keys, or [])
- Do NOT wrap in code blocks. No text before or after.

REAL NARRATIVE REPORT (USE ONLY THESE NUMBERS):
${dataContext}`;
}

// ══════════════════════════════════════════════════════════════════
// SPEC BUILDER: Alpha Report (Cross-signal real data)
// ══════════════════════════════════════════════════════════════════
function buildAlphaSpec(report: AlphaReport): string {
  const lines: string[] = [];
  const push = (line: string) => lines.push(line);

  push(`{"op":"add","path":"/root","value":"glow-wrapper"}`);

  const mainChildren: string[] = [];

  // ── Summary metrics ──
  mainChildren.push("summary-row");
  const totalSignals =
    report.divergences.length +
    report.volumeAnomalies.length +
    report.confidenceClusters.length +
    report.liquidityImbalances.length;

  push(
    `{"op":"add","path":"/elements/am-signals","value":{"type":"Metric","props":{"label":"Alpha Signals","value":"${totalSignals}","format":"number"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/am-markets","value":{"type":"Metric","props":{"label":"Markets Analyzed","value":"${report.totalMarketsAnalyzed}","format":"number"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/am-coins","value":{"type":"Metric","props":{"label":"Coins Analyzed","value":"${report.totalCoinsAnalyzed}","format":"number"},"children":[]}}`
  );

  const biggestDiv = report.divergences.length > 0
    ? `${(report.divergences[0].divergence * 100).toFixed(1)}%`
    : "0%";
  push(
    `{"op":"add","path":"/elements/am-div","value":{"type":"Metric","props":{"label":"Biggest Divergence","value":"${esc(biggestDiv)}","format":"percent"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/summary-row","value":{"type":"Stack","props":{"gap":"md","direction":"horizontal"},"children":["am-signals","am-markets","am-coins","am-div"]}}`
  );

  // ── Composite ScoreRing ──
  const compositeScore = Math.min(100, Math.round(totalSignals * 12 + (report.divergences.length > 0 ? report.divergences[0].divergence * 100 : 0)));
  mainChildren.push("alpha-score");
  push(
    `{"op":"add","path":"/elements/alpha-score","value":{"type":"ScoreRing","props":{"score":${compositeScore},"label":"ALPHA SCORE","color":"emerald","size":"lg"},"children":[]}}`
  );

  // ── AlertBanner for top divergence ──
  if (report.divergences.length > 0) {
    const topDiv = report.divergences[0];
    mainChildren.push("top-alert");
    push(
      `{"op":"add","path":"/elements/top-alert","value":{"type":"AlertBanner","props":{"title":"Top Divergence: ${esc(topDiv.coin.symbol.toUpperCase())}","message":"${esc(`Market prob ${(topDiv.marketProbability * 100).toFixed(1)}% vs price-implied ${(topDiv.priceImpliedProbability * 100).toFixed(1)}% — ${(topDiv.divergence * 100).toFixed(1)}% gap`)}","severity":"alpha"},"children":[]}}`
    );
  }

  // ── Price-Market Divergences ──
  if (report.divergences.length > 0) {
    mainChildren.push("div-divergences", "divergences-heading");
    push(
      `{"op":"add","path":"/elements/div-divergences","value":{"type":"Divider","props":{"label":"Price-Market Divergences"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/divergences-heading","value":{"type":"Heading","props":{"text":"Where prediction markets disagree with price trends","size":"sm"},"children":[]}}`
    );

    // DivergenceBar for each divergence
    report.divergences.slice(0, 6).forEach((d, i) => {
      const divBarKey = `alpha-divbar-${i}`;
      mainChildren.push(divBarKey);
      push(
        `{"op":"add","path":"/elements/${divBarKey}","value":{"type":"DivergenceBar","props":{"leftLabel":"Market ${esc(d.coin.symbol.toUpperCase())}","leftValue":${(d.marketProbability * 100).toFixed(1)},"rightLabel":"Price-Implied","rightValue":${(d.priceImpliedProbability * 100).toFixed(1)},"maxValue":100},"children":[]}}`
      );
    });

    const divCols = ["Token", "Market Question", "Market Prob", "Price-Implied", "Gap", "Direction"];
    const divRows = report.divergences.slice(0, 8).map((d) => {
      const shortQ = d.market.question.length > 40 ? d.market.question.slice(0, 37) + "..." : d.market.question;
      return [
        d.coin.symbol.toUpperCase(),
        shortQ,
        `${(d.marketProbability * 100).toFixed(1)}%`,
        `${(d.priceImpliedProbability * 100).toFixed(1)}%`,
        `${(d.divergence * 100).toFixed(1)}%`,
        d.direction === "market_bullish" ? "Market Bullish" : d.direction === "market_bearish" ? "Market Bearish" : "Aligned",
      ];
    });
    mainChildren.push("divergences-table");
    push(
      `{"op":"add","path":"/elements/divergences-table","value":{"type":"Table","props":{"columns":${JSON.stringify(divCols)},"rows":${JSON.stringify(divRows.map((r) => r.map((c) => esc(c))))}},"children":[]}}`
    );

    // Divergence bars
    mainChildren.push("div-bars");
    const divBars = report.divergences.slice(0, 6).map((d, i) => {
      const colors = ["amber", "red", "cyan", "violet", "emerald", "amber"];
      return `{"label":"${esc(d.coin.symbol.toUpperCase())}","value":${Math.round(d.divergence * 100)},"color":"${colors[i]}"}`;
    });
    push(
      `{"op":"add","path":"/elements/div-bars","value":{"type":"BarChart","props":{"bars":[${divBars.join(",")}]},"children":[]}}`
    );
  }

  // ── Volume Anomalies ──
  if (report.volumeAnomalies.length > 0) {
    mainChildren.push("div-anomalies");
    push(
      `{"op":"add","path":"/elements/div-anomalies","value":{"type":"Divider","props":{"label":"Volume Anomalies"},"children":[]}}`
    );

    report.volumeAnomalies.slice(0, 5).forEach((a, i) => {
      const wrapKey = `anom-wrap-${i}`;
      const textKey = `anom-text-${i}`;
      const barKey = `anom-bar-${i}`;
      mainChildren.push(wrapKey);

      const shortQ = a.market.question.length > 70 ? a.market.question.slice(0, 67) + "..." : a.market.question;
      push(
        `{"op":"add","path":"/elements/${textKey}","value":{"type":"Text","props":{"content":"${esc(shortQ)}"},"children":[]}}`
      );
      push(
        `{"op":"add","path":"/elements/${barKey}","value":{"type":"ProgressBar","props":{"label":"Anomaly score: ${a.anomalyScore.toFixed(1)}x","value":${Math.min(Math.round(a.anomalyScore * 10), 100)},"max":100,"color":"red"},"children":[]}}`
      );
      push(
        `{"op":"add","path":"/elements/${wrapKey}","value":{"type":"Stack","props":{"gap":"sm","direction":"vertical"},"children":["${textKey}","${barKey}"]}}`
      );
    });
  }

  // ── Confidence Clusters ──
  if (report.confidenceClusters.length > 0) {
    mainChildren.push("div-clusters", "clusters-table");
    push(
      `{"op":"add","path":"/elements/div-clusters","value":{"type":"Divider","props":{"label":"Confidence Clusters"},"children":[]}}`
    );

    const clusterCols = ["Topic", "Markets", "Avg Confidence", "Direction"];
    const clusterRows = report.confidenceClusters.slice(0, 6).map((c) => [
      c.topic,
      String(c.markets.length),
      `${(c.avgConfidence * 100).toFixed(1)}%`,
      c.direction,
    ]);
    push(
      `{"op":"add","path":"/elements/clusters-table","value":{"type":"Table","props":{"columns":${JSON.stringify(clusterCols)},"rows":${JSON.stringify(clusterRows.map((r) => r.map((c) => esc(c))))}},"children":[]}}`
    );
  }

  // ── Liquidity Imbalances ──
  if (report.liquidityImbalances.length > 0) {
    mainChildren.push("div-liq", "liq-heading");
    push(
      `{"op":"add","path":"/elements/div-liq","value":{"type":"Divider","props":{"label":"Liquidity Imbalances"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/liq-heading","value":{"type":"Heading","props":{"text":"High confidence + low liquidity = potential edge","size":"sm"},"children":[]}}`
    );

    report.liquidityImbalances.slice(0, 5).forEach((l, i) => {
      const wrapKey = `liq-wrap-${i}`;
      const textKey = `liq-text-${i}`;
      const badgeKey = `liq-badge-${i}`;
      mainChildren.push(wrapKey);

      const shortQ = l.market.question.length > 70 ? l.market.question.slice(0, 67) + "..." : l.market.question;
      push(
        `{"op":"add","path":"/elements/${textKey}","value":{"type":"Text","props":{"content":"${esc(shortQ)}"},"children":[]}}`
      );
      push(
        `{"op":"add","path":"/elements/${badgeKey}","value":{"type":"Badge","props":{"label":"${esc(l.signal.slice(0, 60))}","variant":"success"},"children":[]}}`
      );
      push(
        `{"op":"add","path":"/elements/${wrapKey}","value":{"type":"Stack","props":{"gap":"sm","direction":"vertical"},"children":["${textKey}","${badgeKey}"]}}`
      );
    });
  }

  // ── No signals fallback ──
  if (totalSignals === 0) {
    mainChildren.push("no-signals");
    push(
      `{"op":"add","path":"/elements/no-signals","value":{"type":"Text","props":{"content":"${esc("No significant alpha signals detected. Markets appear efficiently priced relative to crypto price trends. Check back when news breaks — that's when divergences emerge.")}"},"children":[]}}`
    );
  }

  // ── Assemble with GlowCard wrapper ──
  push(
    `{"op":"add","path":"/elements/main-stack","value":{"type":"Stack","props":{"gap":"lg","direction":"vertical"},"children":${JSON.stringify(mainChildren)}}}`
  );
  push(
    `{"op":"add","path":"/elements/card-main","value":{"type":"Card","props":{"title":"Cross-Signal Alpha Report","description":"Prediction markets x crypto price intelligence"},"children":["main-stack"]}}`
  );
  push(
    `{"op":"add","path":"/elements/glow-wrapper","value":{"type":"GlowCard","props":{"intensity":"high"},"children":["card-main"]}}`
  );

  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════
// SPEC BUILDER: Whale Intelligence (Helius + Allium + Predictions)
// ══════════════════════════════════════════════════════════════════
function buildWhaleSpec(profile: WhaleProfile, walletData: WalletAnalyticsPayload): string {
  const lines: string[] = [];
  const push = (line: string) => lines.push(line);

  const addr = walletData.address;
  const short = `${addr.slice(0, 4)}...${addr.slice(-4)}`;

  push(`{"op":"add","path":"/root","value":"card-main"}`);

  const mainChildren: string[] = [];

  // ── Strategy + Risk badges ──
  mainChildren.push("badges-row");
  const strategyLabel = profile.primaryStrategy.type.replace(/_/g, " ").toUpperCase();
  const riskVariant = profile.riskRating === "high" ? "danger" : profile.riskRating === "medium" ? "warning" : "success";
  push(
    `{"op":"add","path":"/elements/badge-strategy","value":{"type":"Badge","props":{"label":"${esc(strategyLabel)}","variant":"info"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/badge-risk","value":{"type":"Badge","props":{"label":"${esc(profile.riskRating.toUpperCase())} RISK","variant":"${riskVariant}"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/badge-activity","value":{"type":"Badge","props":{"label":"${esc(profile.activity.classification.toUpperCase())} TRADER","variant":"default"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/badge-conc","value":{"type":"Badge","props":{"label":"${esc(profile.concentration.diversificationRating.toUpperCase())}","variant":"${profile.concentration.diversificationRating === "diversified" ? "success" : profile.concentration.diversificationRating === "moderate" ? "warning" : "danger"}"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/badges-row","value":{"type":"Stack","props":{"gap":"sm","direction":"horizontal"},"children":["badge-strategy","badge-risk","badge-activity","badge-conc"]}}`
  );

  // ── Key metrics ──
  mainChildren.push("metrics-row");
  push(
    `{"op":"add","path":"/elements/wm-sol","value":{"type":"Metric","props":{"label":"SOL Balance","value":"${walletData.solBalance.toFixed(4)} SOL","format":"number"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/wm-tokens","value":{"type":"Metric","props":{"label":"Tokens","value":"${walletData.tokenCount}","format":"number"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/wm-nfts","value":{"type":"Metric","props":{"label":"NFTs","value":"${walletData.nftCount}","format":"number"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/wm-txday","value":{"type":"Metric","props":{"label":"Avg Tx/Day","value":"${profile.activity.avgTxPerDay.toFixed(2)}","format":"number"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/metrics-row","value":{"type":"Stack","props":{"gap":"md","direction":"horizontal"},"children":["wm-sol","wm-tokens","wm-nfts","wm-txday"]}}`
  );

  // ── Summary text ──
  mainChildren.push("summary-text");
  push(
    `{"op":"add","path":"/elements/summary-text","value":{"type":"Text","props":{"content":"${esc(profile.summary)}"},"children":[]}}`
  );

  // ── RadarChart for strategy profile ──
  mainChildren.push("div-strategy", "strategy-heading");
  push(
    `{"op":"add","path":"/elements/div-strategy","value":{"type":"Divider","props":{"label":"Strategy Classification"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/strategy-heading","value":{"type":"Heading","props":{"text":"Confidence by Strategy Type","size":"sm"},"children":[]}}`
  );

  // RadarChart for strategy dimensions
  if (profile.strategies.length >= 3) {
    mainChildren.push("strategy-radar");
    const radarAxes = profile.strategies.slice(0, 6).map((s) =>
      `{"label":"${esc(s.type.replace(/_/g, " "))}","value":${Math.round(s.confidence * 100)},"max":100}`
    );
    push(
      `{"op":"add","path":"/elements/strategy-radar","value":{"type":"RadarChart","props":{"axes":[${radarAxes.join(",")}],"color":"cyan","size":200},"children":[]}}`
    );
  }

  const stratBars = profile.strategies.slice(0, 5).map((s, i) => {
    const colors = ["emerald", "cyan", "amber", "violet", "red"];
    return `{"label":"${esc(s.type.replace(/_/g, " "))}","value":${Math.round(s.confidence * 100)},"color":"${colors[i]}"}`;
  });
  mainChildren.push("strategy-bars");
  push(
    `{"op":"add","path":"/elements/strategy-bars","value":{"type":"BarChart","props":{"bars":[${stratBars.join(",")}]},"children":[]}}`
  );

  // ── ScoreRing for risk ──
  const riskScore = profile.riskRating === "high" ? 85 : profile.riskRating === "medium" ? 55 : 25;
  mainChildren.push("risk-score-ring");
  push(
    `{"op":"add","path":"/elements/risk-score-ring","value":{"type":"ScoreRing","props":{"score":${riskScore},"label":"RISK","color":"${profile.riskRating === "high" ? "red" : profile.riskRating === "medium" ? "amber" : "emerald"}","size":"md"},"children":[]}}`
  );

  // ── Concentration ──
  mainChildren.push("div-conc");
  push(
    `{"op":"add","path":"/elements/div-conc","value":{"type":"Divider","props":{"label":"Portfolio Concentration"},"children":[]}}`
  );

  // AlertBanner for concentration warning
  if (profile.concentration.herfindahlIndex > 0.4) {
    mainChildren.push("conc-alert");
    push(
      `{"op":"add","path":"/elements/conc-alert","value":{"type":"AlertBanner","props":{"title":"High Concentration Risk","message":"${esc(`HHI ${profile.concentration.herfindahlIndex.toFixed(2)} — top holding is ${Math.round(profile.concentration.topHoldingPct)}% of portfolio`)}","severity":"warning"},"children":[]}}`
    );
  }

  mainChildren.push("conc-top", "conc-top3", "conc-hhi");
  push(
    `{"op":"add","path":"/elements/conc-top","value":{"type":"ProgressBar","props":{"label":"Top Holding","value":${Math.round(profile.concentration.topHoldingPct)},"max":100,"color":"amber"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/conc-top3","value":{"type":"ProgressBar","props":{"label":"Top 3 Holdings","value":${Math.round(profile.concentration.top3Pct)},"max":100,"color":"cyan"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/conc-hhi","value":{"type":"ProgressBar","props":{"label":"HHI (1.0 = fully concentrated)","value":${Math.round(profile.concentration.herfindahlIndex * 100)},"max":100,"color":"${profile.concentration.herfindahlIndex > 0.5 ? "red" : profile.concentration.herfindahlIndex > 0.2 ? "amber" : "emerald"}"},"children":[]}}`
  );

  // ── TokenRow for top holdings ──
  const topHoldings = walletData.tokenAccounts
    .filter((t) => t.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  if (topHoldings.length > 0) {
    mainChildren.push("div-holdings", "holdings-heading");
    push(
      `{"op":"add","path":"/elements/div-holdings","value":{"type":"Divider","props":{"label":"Top Holdings"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/holdings-heading","value":{"type":"Heading","props":{"text":"Largest token positions","size":"sm"},"children":[]}}`
    );
    topHoldings.forEach((t, i) => {
      const symbol = t.symbol || t.mint.slice(0, 6);
      const dec = t.decimals ?? 0;
      const amt = dec > 0 ? (t.amount / Math.pow(10, dec)) : t.amount;
      const holdKey = `whale-token-${i}`;
      mainChildren.push(holdKey);
      push(
        `{"op":"add","path":"/elements/${holdKey}","value":{"type":"TokenRow","props":{"name":"${esc(symbol)}","symbol":"${esc(symbol)}","imageUrl":null,"price":"${esc(amt.toLocaleString(undefined, { maximumFractionDigits: 4 }))}","change":null,"sparklineData":null,"rank":${i + 1}},"children":[]}}`
      );
    });
  }

  // ── Prediction Cross-References ──
  if (profile.predictionCrossRefs.length > 0) {
    mainChildren.push("div-crossref", "crossref-heading", "crossref-table");
    push(
      `{"op":"add","path":"/elements/div-crossref","value":{"type":"Divider","props":{"label":"Prediction Market Cross-References"},"children":[]}}`
    );
    push(
      `{"op":"add","path":"/elements/crossref-heading","value":{"type":"Heading","props":{"text":"How prediction markets relate to holdings","size":"sm"},"children":[]}}`
    );

    const crossCols = ["Token", "Market", "YES Prob", "Relevance"];
    const crossRows: string[][] = [];
    for (const ref of profile.predictionCrossRefs) {
      for (const m of ref.relatedMarkets.slice(0, 2)) {
        const shortQ = m.question.length > 45 ? m.question.slice(0, 42) + "..." : m.question;
        crossRows.push([
          ref.tokenSymbol,
          shortQ,
          `${(m.yesPrice * 100).toFixed(1)}%`,
          m.relevance.length > 40 ? m.relevance.slice(0, 37) + "..." : m.relevance,
        ]);
      }
    }
    push(
      `{"op":"add","path":"/elements/crossref-table","value":{"type":"Table","props":{"columns":${JSON.stringify(crossCols)},"rows":${JSON.stringify(crossRows.map((r) => r.map((c) => esc(c))))}},"children":[]}}`
    );
  }

  // ── Buttons ──
  mainChildren.push("btns-row");
  push(
    `{"op":"add","path":"/elements/btn-solscan","value":{"type":"Button","props":{"label":"View on Solscan","action":"navigate","params":{"url":"${esc(`https://solscan.io/account/${addr}`)}"}},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/btns-row","value":{"type":"Stack","props":{"gap":"sm","direction":"horizontal"},"children":["btn-solscan"]}}`
  );

  // ── Assemble ──
  push(
    `{"op":"add","path":"/elements/main-stack","value":{"type":"Stack","props":{"gap":"lg","direction":"vertical"},"children":${JSON.stringify(mainChildren)}}}`
  );
  push(
    `{"op":"add","path":"/elements/card-main","value":{"type":"Card","props":{"title":"Whale Intelligence: ${esc(short)}","description":"${esc(addr)}"},"children":["main-stack"]}}`
  );

  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════
// SPEC BUILDER: Narrative Report (Prediction markets x Token impacts)
// ══════════════════════════════════════════════════════════════════
function buildNarrativeSpec(report: NarrativeReport): string {
  const lines: string[] = [];
  const push = (line: string) => lines.push(line);

  push(`{"op":"add","path":"/root","value":"card-main"}`);

  const mainChildren: string[] = [];

  // ── Summary metrics ──
  mainChildren.push("summary-row");
  push(
    `{"op":"add","path":"/elements/nm-themes","value":{"type":"Metric","props":{"label":"Active Narratives","value":"${report.totalThemesMatched}","format":"number"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/nm-markets","value":{"type":"Metric","props":{"label":"Markets Analyzed","value":"${report.totalMarketsAnalyzed}","format":"number"},"children":[]}}`
  );

  const topNarrative = report.narratives.length > 0 ? report.narratives[0] : null;
  push(
    `{"op":"add","path":"/elements/nm-top","value":{"type":"Metric","props":{"label":"Strongest Theme","value":"${esc(topNarrative ? topNarrative.theme.name : "None")}","format":"number"},"children":[]}}`
  );
  const topScore = topNarrative ? topNarrative.compositeScore.toFixed(1) : "0";
  push(
    `{"op":"add","path":"/elements/nm-score","value":{"type":"Metric","props":{"label":"Top Score","value":"${esc(topScore)}/100","format":"number"},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/summary-row","value":{"type":"Stack","props":{"gap":"md","direction":"horizontal"},"children":["nm-themes","nm-markets","nm-top","nm-score"]}}`
  );

  if (report.narratives.length === 0) {
    mainChildren.push("no-narratives");
    push(
      `{"op":"add","path":"/elements/no-narratives","value":{"type":"Text","props":{"content":"${esc("No active narrative themes detected in current prediction markets. The market may be in a low-catalyst period.")}"},"children":[]}}`
    );
  } else {
    // ── HeatMap overview of all narratives ──
    if (report.narratives.length >= 3) {
      mainChildren.push("narr-heatmap");
      const heatCells = report.narratives.slice(0, 12).map((n) => {
        const shortName = n.theme.name.length > 20 ? n.theme.name.slice(0, 17) + "..." : n.theme.name;
        // Map composite score 0-100 to diverging range for heatmap color
        const heatVal = (n.compositeScore - 50) * 2; // -100 to +100
        return `{"label":"${esc(shortName)}","value":${heatVal.toFixed(1)},"weight":${n.matchedMarkets.length > 3 ? 2 : 1}}`;
      });
      push(
        `{"op":"add","path":"/elements/narr-heatmap","value":{"type":"HeatMap","props":{"cells":[${heatCells.join(",")}],"columns":${Math.min(4, Math.ceil(Math.sqrt(report.narratives.length)))}},"children":[]}}`
      );
    }

    // ── ScoreRings for top 3 narratives ──
    const topNarratives = report.narratives.slice(0, 3);
    if (topNarratives.length > 0) {
      mainChildren.push("score-rings-row");
      const ringKeys: string[] = [];
      topNarratives.forEach((n, i) => {
        const ringKey = `narr-ring-${i}`;
        ringKeys.push(ringKey);
        const ringColors = ["emerald", "cyan", "amber"];
        const shortName = n.theme.name.length > 12 ? n.theme.name.slice(0, 10) + ".." : n.theme.name;
        push(
          `{"op":"add","path":"/elements/${ringKey}","value":{"type":"ScoreRing","props":{"score":${Math.round(n.compositeScore)},"label":"${esc(shortName)}","color":"${ringColors[i]}","size":"sm"},"children":[]}}`
        );
      });
      push(
        `{"op":"add","path":"/elements/score-rings-row","value":{"type":"Stack","props":{"gap":"md","direction":"horizontal"},"children":${JSON.stringify(ringKeys)}}}`
      );
    }

    // ── Narrative score bars ──
    mainChildren.push("div-scores", "score-bars");
    push(
      `{"op":"add","path":"/elements/div-scores","value":{"type":"Divider","props":{"label":"Narrative Scores"},"children":[]}}`
    );

    const scoreBars = report.narratives.slice(0, 8).map((n, i) => {
      const colors = ["emerald", "cyan", "amber", "violet", "red", "emerald", "cyan", "amber"];
      const shortName = n.theme.name.length > 25 ? n.theme.name.slice(0, 22) + "..." : n.theme.name;
      return `{"label":"${esc(shortName)}","value":${Math.round(n.compositeScore)},"color":"${colors[i]}"}`;
    });
    push(
      `{"op":"add","path":"/elements/score-bars","value":{"type":"BarChart","props":{"bars":[${scoreBars.join(",")}]},"children":[]}}`
    );

    // ── Detailed breakdown for top narratives ──
    report.narratives.slice(0, 5).forEach((n, i) => {
      const sectionKey = `narr-section-${i}`;
      const divKey = `narr-div-${i}`;
      const headKey = `narr-head-${i}`;
      const textKey = `narr-text-${i}`;
      const confKey = `narr-conf-${i}`;
      const momKey = `narr-mom-${i}`;
      mainChildren.push(divKey, sectionKey);

      push(
        `{"op":"add","path":"/elements/${divKey}","value":{"type":"Divider","props":{"label":"${esc(n.theme.name)}"},"children":[]}}`
      );

      const sectionChildren = [headKey, textKey, confKey, momKey];

      push(
        `{"op":"add","path":"/elements/${headKey}","value":{"type":"Heading","props":{"text":"Score: ${n.compositeScore.toFixed(1)}/100 | ${n.matchedMarkets.length} markets","size":"sm"},"children":[]}}`
      );
      push(
        `{"op":"add","path":"/elements/${textKey}","value":{"type":"Text","props":{"content":"${esc(n.summary)}"},"children":[]}}`
      );
      push(
        `{"op":"add","path":"/elements/${confKey}","value":{"type":"ProgressBar","props":{"label":"Avg Confidence","value":${Math.round(n.avgConfidence * 100)},"max":100,"color":"${n.avgConfidence > 0.6 ? "emerald" : n.avgConfidence < 0.4 ? "red" : "amber"}"},"children":[]}}`
      );
      push(
        `{"op":"add","path":"/elements/${momKey}","value":{"type":"ProgressBar","props":{"label":"Momentum","value":${Math.round(50 + n.momentum * 50)},"max":100,"color":"${n.momentum > 0.2 ? "emerald" : n.momentum < -0.2 ? "red" : "amber"}"},"children":[]}}`
      );

      // Token impacts — use TokenRow instead of Table for visual impact
      if (n.tokenImpacts.length > 0) {
        n.tokenImpacts.forEach((t, ti) => {
          const tokenRowKey = `narr-tokenrow-${i}-${ti}`;
          sectionChildren.push(tokenRowKey);
          const change24 = t.change24h != null ? `${t.change24h >= 0 ? "+" : ""}${t.change24h.toFixed(2)}%` : null;
          push(
            `{"op":"add","path":"/elements/${tokenRowKey}","value":{"type":"TokenRow","props":{"name":"${esc(t.coinSymbol)}","symbol":"${esc(t.coinSymbol)}","imageUrl":null,"price":"$${t.currentPrice.toLocaleString()}","change":${change24 ? `"${esc(change24)}"` : "null"},"sparklineData":null,"rank":null},"children":[]}}`
          );
        });
      }

      push(
        `{"op":"add","path":"/elements/${sectionKey}","value":{"type":"Stack","props":{"gap":"sm","direction":"vertical"},"children":${JSON.stringify(sectionChildren)}}}`
      );
    });
  }

  // ── Buttons ──
  mainChildren.push("btns-row");
  push(
    `{"op":"add","path":"/elements/btn-poly","value":{"type":"Button","props":{"label":"Explore Polymarket","action":"navigate","params":{"url":"https://polymarket.com"}},"children":[]}}`
  );
  push(
    `{"op":"add","path":"/elements/btns-row","value":{"type":"Stack","props":{"gap":"sm","direction":"horizontal"},"children":["btn-poly"]}}`
  );

  // ── Assemble ──
  push(
    `{"op":"add","path":"/elements/main-stack","value":{"type":"Stack","props":{"gap":"lg","direction":"vertical"},"children":${JSON.stringify(mainChildren)}}}`
  );
  push(
    `{"op":"add","path":"/elements/card-main","value":{"type":"Card","props":{"title":"Narrative Engine","description":"Prediction markets mapped to token impacts"},"children":["main-stack"]}}`
  );

  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════
// ROUTE HANDLER
// ══════════════════════════════════════════════════════════════════
async function handlePost(req: Request) {
  const { rateLimit: rateLimitFn, getClientIdentifier } = await import(
    "@/lib/rate-limit"
  );
  const limiter = rateLimitFn(getClientIdentifier(req), "generate");
  if (!limiter.ok) {
    const retryAfterSeconds = Math.ceil(limiter.resetIn / 1000);
    return streamStatusSpec(
      "Rate Limited",
      `Too many requests right now. Retry after ${retryAfterSeconds}s.`,
      429,
      { "Retry-After": String(retryAfterSeconds) }
    );
  }

  const { prompt, currentTree } = await req.json().catch(() => ({}));
  const rawPrompt = typeof prompt === "string" ? prompt.trim() : "";
  const userPrompt =
    rawPrompt === "/" ||
      rawPrompt.toLowerCase() === "/pump" ||
      rawPrompt.toLowerCase() === "/pumpfun" ||
      rawPrompt.toLowerCase() === "/pf"
      ? "show me new pump.fun tokens"
      : rawPrompt;
  const lowerPrompt = userPrompt.toLowerCase();
  let queryType = classifyQuery(userPrompt);

  // ═══════════════════════════════════════════════════════════════
  // PATH 0: Token query → mint/ticker intelligence + clone scan
  // ═══════════════════════════════════════════════════════════════
  if (queryType === "token") {
    const tokenLookupId = extractTokenLookupHint(userPrompt);
    if (tokenLookupId) {
      try {
        const token = await fetchTokenLookup(req, tokenLookupId);
        if (token) {
          const sharePackContext = buildTokenSharePackContext(req, token);

          // SUPER DASHBOARD: Fetch exhaustive metadata if requested
          const isSuper = /\b(super|exhaustive|full|dashboard|deep|complete|alpha)\b/.test(lowerPrompt);

          const convexIntel = await fetchConvexTokenIntelHydration(
            userPrompt,
            token,
            isSuper
          );

          let coinDetail: CoinDetail | null = null;
          if (isSuper && token.symbol) {
            const cgId = resolveCoinId(token.symbol) || token.symbol.toLowerCase();
            coinDetail = await getCoinDetail(cgId, true).catch(() => null);
          }

          const spec = buildTokenIntelSpec(
            token,
            userPrompt,
            convexIntel,
            sharePackContext,
            coinDetail
          );
          return streamSpec(spec);
        }
      } catch (e) {
        console.error("Token lookup failed:", e);
      }

      const fallbackToken = buildFallbackTokenLookup(tokenLookupId, userPrompt);
      const sharePackContext = buildTokenSharePackContext(req, fallbackToken);
      const fallbackSpec = buildTokenIntelSpec(
        fallbackToken,
        userPrompt,
        null,
        sharePackContext
      );
      return streamSpec(fallbackSpec);
    }

    // Broad "alpha / opportunities / clone-risk" prompts without a specific mint/ticker
    // should route to discovery dashboards instead of hard-failing token lookup.
    const hasPumpIntent =
      /\b(pump\.?fun|pump\s?portal|bonk\.?fun|lets?\s?bonk|pumpswap|launch(?:es)?|new\s?tokens?|migration|graduat(?:ed|ing|ion))\b/.test(
        lowerPrompt
      );
    const hasBroadAlphaIntent =
      /\b(highest-?conviction|conviction|opportunit(?:y|ies)|right\s+now|trending|accelerat(?:ing|ed)|meta|narrative|watchlist|memecoin|meme\s?coin)\b/.test(
        lowerPrompt
      );

    if (hasPumpIntent || hasBroadAlphaIntent) {
      queryType = hasPumpIntent ? "pump" : "alpha";
    } else {
      return streamStatusSpec(
        "Token Lookup Unavailable",
        "Provide a token mint or ticker (for example: DfC2...pump or $LUNCH) to run trust scoring and clone risk."
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PATH 1: Wallet query → 100% server-side from Helius + Allium
  // ═══════════════════════════════════════════════════════════════
  if (queryType === "wallet") {
    const walletAddress = extractSolanaAddress(userPrompt);
    const heliusKey = process.env.HELIUS_API_KEY;

    // For bare-address prompts, try token intelligence first.
    // If the address is a token mint, this avoids mislabeling it as a wallet.
    if (walletAddress) {
      const compactPrompt = userPrompt.replace(/\s+/g, "");
      const isBareAddressPrompt = compactPrompt === walletAddress;
      const hasTokenIntent = /\b(token|ticker|mint|contract|ca\b|fake|clone|same\s?ticker)\b/.test(
        lowerPrompt
      );
      if (isBareAddressPrompt || hasTokenIntent) {
        try {
          const token = await fetchTokenLookup(req, walletAddress);
          if (token) {
            const sharePackContext = buildTokenSharePackContext(req, token);
            const convexIntel = await fetchConvexTokenIntelHydration(
              userPrompt,
              token
            );
            const spec = buildTokenIntelSpec(
              token,
              userPrompt,
              convexIntel,
              sharePackContext
            );
            return streamSpec(spec);
          }
        } catch (tokenErr) {
          console.error("Wallet-path token precheck failed:", tokenErr);
        }
      }
    }

    if (walletAddress && heliusKey) {
      try {
        const walletData = await buildWalletAnalytics(
          heliusKey,
          walletAddress
        );
        const spec = buildWalletSpec(walletData);
        return streamSpec(spec);
      } catch (e) {
        console.error("Helius fetch failed:", e);
        // Fall through to LLM
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PATH 2: PumpPortal query → real-time memecoin snapshot
  // ═══════════════════════════════════════════════════════════════
  if (queryType === "pump") {
    let snapshot: PumpSnapshot | null = null;

    try {
      snapshot = await getPumpSnapshot();
      const spec = buildPumpSpec(snapshot, userPrompt);
      return streamSpec(spec);
    } catch (e) {
      console.error("PumpPortal fetch failed:", e);
      // Fall through to LLM fallback below
    }

    if (process.env.OPENROUTER_API_KEY) {
      try {
        const pumpContext = snapshot
          ? serializePumpForLLM(snapshot)
          : "PumpPortal data unavailable. State this clearly and avoid numeric claims.";
        const pumpSystemPrompt = buildPumpPrompt(pumpContext);
        const result = streamText({
          model: openrouter.chatModel(OPENROUTER_MODEL),
          system: pumpSystemPrompt,
          prompt: userPrompt || "Show me new pump.fun token launches right now.",
        });
        const textStream = result.toTextStreamResponse();
        const filtered = textStream.body!.pipeThrough(createJsonlFilterStream());
        return new Response(filtered, {
          headers: SPEC_STREAM_HEADERS,
        });
      } catch (llmErr) {
        console.error("Pump fallback LLM failed:", llmErr);
      }
    }

    // Never fall through to generic market output for pump queries.
    // Return a deterministic pump dashboard even when live feed/model fails.
    const degradedSnapshot: PumpSnapshot = {
      newTokens: [],
      recentTrades: [],
      migrations: [],
      timestamp: new Date().toISOString(),
    };
    const degradedSpec = buildPumpSpec(
      degradedSnapshot,
      userPrompt || "PumpPortal feed unavailable"
    );
    return streamSpec(degradedSpec);
  }

  // ═══════════════════════════════════════════════════════════════
  // PATH 3: Market query → hybrid (real CoinGecko data + LLM dashboard)
  // ═══════════════════════════════════════════════════════════════
  if (queryType === "market") {
    try {
      const requestedIds = extractCoinIds(userPrompt);

      const [topCoinsData, globalDataResult, trendingData, specificCoins] =
        await Promise.all([
          getTopCoins(20).catch(() => [] as CoinMarketData[]),
          getGlobalData().catch(() => null),
          getTrending().catch(() => [] as TrendingCoinItem[]),
          requestedIds.length > 0
            ? getCoinsByIds(requestedIds).catch(() => [] as CoinMarketData[])
            : Promise.resolve([] as CoinMarketData[]),
        ]);

      let displayCoins = topCoinsData;
      if (specificCoins.length > 0) {
        displayCoins = [...specificCoins, ...topCoinsData.filter(c => !requestedIds.includes(c.id))];
      }

      if ((displayCoins.length > 0 || globalDataResult) && process.env.OPENROUTER_API_KEY) {
        // Build data context for LLM
        const marketDataContext = serializeMarketDataForLLM(displayCoins, globalDataResult, trendingData, userPrompt);

        try {
          const marketSystemPrompt = buildMarketPrompt(marketDataContext);

          const result = streamText({
            model: openrouter.chatModel(OPENROUTER_MODEL),
            system: marketSystemPrompt,
            prompt: userPrompt,
          });

          const textStream = result.toTextStreamResponse();
          const filtered = textStream.body!.pipeThrough(createJsonlFilterStream());

          return new Response(filtered, {
            headers: SPEC_STREAM_HEADERS,
          });
        } catch (llmErr) {
          console.error("Market LLM failed, falling back to static spec:", llmErr);
        }
      }

      // Fallback: static server-side spec
      if (displayCoins.length > 0 || globalDataResult) {
        const spec = buildMarketSpec(
          displayCoins,
          globalDataResult,
          trendingData,
          userPrompt
        );
        return streamSpec(spec);
      }
    } catch (e) {
      console.error("CoinGecko fetch failed:", e);
      // Fall through to LLM
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PATH 4: Prediction query → hybrid (real data + LLM dashboard)
  // ═══════════════════════════════════════════════════════════════
  if (queryType === "prediction") {
    try {
      const keywords = extractPolymarketKeywords(userPrompt);
      const diverseData = await getDiverseMarkets({ keywords, limit: 100 });

      const dataContext = serializeMarketsForLLM({
        ...diverseData,
        keywords,
        prompt: userPrompt,
      });

      // Try LLM-powered custom dashboard if OpenRouter is available
      if (process.env.OPENROUTER_API_KEY) {
        try {
          const predictionSystemPrompt = buildPredictionPrompt(dataContext);

          const result = streamText({
            model: openrouter.chatModel(OPENROUTER_MODEL),
            system: predictionSystemPrompt,
            prompt: userPrompt,
          });

          const textStream = result.toTextStreamResponse();
          const filtered = textStream.body!.pipeThrough(createJsonlFilterStream());

          return new Response(filtered, {
            headers: SPEC_STREAM_HEADERS,
          });
        } catch (llmErr) {
          console.error("Prediction LLM failed, falling back to static spec:", llmErr);
        }
      }

      // Fallback: server-side spec using whatever matched best
      const fallbackMarkets = diverseData.matched.length > 0
        ? diverseData.matched
        : diverseData.topByVolume;
      if (fallbackMarkets.length > 0) {
        const spec = buildPolymarketSpec(fallbackMarkets, userPrompt);
        return streamSpec(spec);
      }
    } catch (e) {
      console.error("Polymarket fetch failed:", e);
      // Fall through to LLM
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PATH 5: Arbitrage → cross-platform Polymarket × Manifold
  // ═══════════════════════════════════════════════════════════════
  if (queryType === "arbitrage") {
    try {
      // Fetch markets from both platforms in parallel
      const [polyMarkets, manifoldMarkets] = await Promise.all([
        getTrendingMarkets(50).catch(() => [] as PredictionMarket[]),
        getManifoldTrending(50).catch(() => [] as PredictionMarket[]),
      ]);

      // Run the arbitrage finder
      const opportunities = findArbitrageOpportunities(
        polyMarkets,
        manifoldMarkets,
        { minSimilarity: 0.6, minSpread: 0.005 }
      );

      const spec = buildArbitrageSpec(
        opportunities,
        polyMarkets.length,
        manifoldMarkets.length,
        userPrompt
      );
      return streamSpec(spec);
    } catch (e) {
      console.error("Arbitrage scan failed:", e);
      // Fall through to LLM
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PATH 6: Alpha Detection → cross-signal analysis
  // ═══════════════════════════════════════════════════════════════
  if (queryType === "alpha") {
    try {
      const [diverseData, topCoinsData, moversData, globalDataResult] = await Promise.all([
        getDiverseMarkets({ limit: 150 }).catch(() => ({
          topByVolume: [] as PredictionMarket[],
          recentlyAdded: [] as PredictionMarket[],
          matched: [] as PredictionMarket[],
          highConfidence: [] as PredictionMarket[],
          closeCall: [] as PredictionMarket[],
          aiEdge: [] as PredictionMarket[],
        })),
        getTopCoins(50).catch(() => [] as CoinMarketData[]),
        getTopMovers(30).catch(() => ({ gainers: [] as CoinMarketData[], losers: [] as CoinMarketData[] })),
        getGlobalData().catch(() => null),
      ]);

      // Combine top coins + movers for comprehensive dynamic coverage
      const seenIds = new Set<string>();
      const combinedCoins: CoinMarketData[] = [];
      for (const c of [...topCoinsData, ...moversData.gainers, ...moversData.losers]) {
        if (!seenIds.has(c.id)) { seenIds.add(c.id); combinedCoins.push(c); }
      }

      const allMarkets = flattenDiverseMarkets(diverseData);
      const report = generateAlphaReport(allMarkets, combinedCoins, globalDataResult);

      if (process.env.OPENROUTER_API_KEY) {
        const dataContext = serializeAlphaForLLM(report, userPrompt);
        try {
          const alphaSystemPrompt = buildAlphaPrompt(dataContext);
          const result = streamText({
            model: openrouter.chatModel(OPENROUTER_MODEL),
            system: alphaSystemPrompt,
            prompt: userPrompt,
          });
          const textStream = result.toTextStreamResponse();
          const filtered = textStream.body!.pipeThrough(createJsonlFilterStream());
          return new Response(filtered, {
            headers: SPEC_STREAM_HEADERS,
          });
        } catch (llmErr) {
          console.error("Alpha LLM failed, falling back to static spec:", llmErr);
        }
      }

      // Fallback: static spec
      const spec = buildAlphaSpec(report);
      return streamSpec(spec);
    } catch (e) {
      console.error("Alpha detection failed:", e);
      // Fall through to LLM
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PATH 7: Whale Intelligence → deep wallet analysis + prediction cross-ref
  // ═══════════════════════════════════════════════════════════════
  if (queryType === "whale") {
    const walletAddress = extractSolanaAddress(userPrompt);
    const heliusKey = process.env.HELIUS_API_KEY;

    if (walletAddress && heliusKey) {
      try {
        const [walletData, diverseData, whaleCoinsData] = await Promise.all([
          buildWalletAnalytics(heliusKey, walletAddress),
          getDiverseMarkets({ limit: 100 }).catch(() => ({
            topByVolume: [] as PredictionMarket[],
            recentlyAdded: [] as PredictionMarket[],
            matched: [] as PredictionMarket[],
            highConfidence: [] as PredictionMarket[],
            closeCall: [] as PredictionMarket[],
            aiEdge: [] as PredictionMarket[],
          })),
          getTopCoins(100).catch(() => [] as CoinMarketData[]),
        ]);

        const allMarkets = flattenDiverseMarkets(diverseData);
        const profile = buildWhaleProfile(walletData, allMarkets, whaleCoinsData);

        if (process.env.OPENROUTER_API_KEY) {
          const dataContext = serializeWhaleForLLM(profile, walletData, userPrompt);
          try {
            const whaleSystemPrompt = buildWhalePrompt(dataContext);
            const result = streamText({
              model: openrouter.chatModel(OPENROUTER_MODEL),
              system: whaleSystemPrompt,
              prompt: userPrompt,
            });
            const textStream = result.toTextStreamResponse();
            const filtered = textStream.body!.pipeThrough(createJsonlFilterStream());
            return new Response(filtered, {
              headers: SPEC_STREAM_HEADERS,
            });
          } catch (llmErr) {
            console.error("Whale LLM failed, falling back to static spec:", llmErr);
          }
        }

        // Fallback: static spec
        const spec = buildWhaleSpec(profile, walletData);
        return streamSpec(spec);
      } catch (e) {
        console.error("Whale intelligence failed:", e);
        // Fall through to LLM
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PATH 8: Narrative Engine → map prediction events to impacted tokens
  // ═══════════════════════════════════════════════════════════════
  if (queryType === "narrative") {
    try {
      const [diverseData, narrativeCoins, narrativeMovers, globalDataResult] = await Promise.all([
        getDiverseMarkets({ limit: 150 }).catch(() => ({
          topByVolume: [] as PredictionMarket[],
          recentlyAdded: [] as PredictionMarket[],
          matched: [] as PredictionMarket[],
          highConfidence: [] as PredictionMarket[],
          closeCall: [] as PredictionMarket[],
          aiEdge: [] as PredictionMarket[],
        })),
        getTopCoins(50).catch(() => [] as CoinMarketData[]),
        getTopMovers(20).catch(() => ({ gainers: [] as CoinMarketData[], losers: [] as CoinMarketData[] })),
        getGlobalData().catch(() => null),
      ]);

      // Combine for broader narrative token coverage
      const seenIds = new Set<string>();
      const narrativeCombined: CoinMarketData[] = [];
      for (const c of [...narrativeCoins, ...narrativeMovers.gainers, ...narrativeMovers.losers]) {
        if (!seenIds.has(c.id)) { seenIds.add(c.id); narrativeCombined.push(c); }
      }

      const allMarkets = flattenDiverseMarkets(diverseData);
      const report = generateNarrativeReport(allMarkets, narrativeCombined, globalDataResult);

      if (process.env.OPENROUTER_API_KEY) {
        const dataContext = serializeNarrativeForLLM(report, userPrompt);
        try {
          const narrativeSystemPrompt = buildNarrativePrompt(dataContext);
          const result = streamText({
            model: openrouter.chatModel(OPENROUTER_MODEL),
            system: narrativeSystemPrompt,
            prompt: userPrompt,
          });
          const textStream = result.toTextStreamResponse();
          const filtered = textStream.body!.pipeThrough(createJsonlFilterStream());
          return new Response(filtered, {
            headers: SPEC_STREAM_HEADERS,
          });
        } catch (llmErr) {
          console.error("Narrative LLM failed, falling back to static spec:", llmErr);
        }
      }

      // Fallback: static spec
      const spec = buildNarrativeSpec(report);
      return streamSpec(spec);
    } catch (e) {
      console.error("Narrative engine failed:", e);
      // Fall through to LLM
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PATH 9: General query → LLM with real data context injected
  // ═══════════════════════════════════════════════════════════════
  if (process.env.OPENROUTER_API_KEY) {
    // Fetch real data to inject as context so LLM doesn't hallucinate
    let dataContext = "No real-time data available. State this clearly in your response.";
    try {
      const [topCoins, globalInfo, trending] = await Promise.all([
        getTopCoins(10).catch(() => []),
        getGlobalData().catch(() => null),
        getTrending().catch(() => []),
      ]);

      const parts: string[] = [];

      if (globalInfo) {
        parts.push(
          `Global: Total Market Cap=${formatUsd(globalInfo.total_market_cap?.usd ?? 0)}, 24h Change=${formatPct(globalInfo.market_cap_change_percentage_24h_usd)}, 24h Volume=${formatUsd(globalInfo.total_volume?.usd ?? 0)}, BTC Dominance=${(globalInfo.market_cap_percentage?.btc ?? 0).toFixed(1)}%, ETH Dominance=${(globalInfo.market_cap_percentage?.eth ?? 0).toFixed(1)}%`
        );
      }

      if (topCoins.length > 0) {
        parts.push("Top coins:");
        topCoins.forEach((c) => {
          parts.push(
            `  ${c.name} (${c.symbol.toUpperCase()}): Price=${formatUsd(c.current_price)}, 24h=${formatPct(c.price_change_percentage_24h)}, 7d=${formatPct(c.price_change_percentage_7d_in_currency)}, MCap=${formatUsd(c.market_cap)}, Vol=${formatUsd(c.total_volume)}`
          );
        });
      }

      if (trending.length > 0) {
        parts.push(
          `Trending coins: ${trending.slice(0, 5).map((t) => `${t.name} (${t.symbol.toUpperCase()})`).join(", ")}`
        );
      }

      if (parts.length > 0) {
        dataContext = parts.join("\n");
      }
    } catch {
      // Use no-data context
    }

    const systemPrompt = buildSystemPrompt(dataContext, currentTree);
    const finalPrompt =
      userPrompt || "Give me a crypto market overview with real data.";

    const result = streamText({
      model: openrouter.chatModel(OPENROUTER_MODEL),
      system: systemPrompt,
      prompt: finalPrompt,
    });

    const textStream = result.toTextStreamResponse();
    const filtered = textStream.body!.pipeThrough(createJsonlFilterStream());

    return new Response(filtered, {
      headers: SPEC_STREAM_HEADERS,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // FALLBACK: No API keys → try CoinGecko anyway (no key needed)
  // ═══════════════════════════════════════════════════════════════
  try {
    const [topCoins, globalData, trending] = await Promise.all([
      getTopCoins(15),
      getGlobalData().catch(() => null),
      getTrending().catch(() => []),
    ]);
    const spec = buildMarketSpec(topCoins, globalData, trending, userPrompt || "Crypto Market Overview");
    return streamSpec(spec);
  } catch {
    // Final fallback: static demo
    const DEMO = [
      '{"op":"add","path":"/root","value":"card-1"}',
      '{"op":"add","path":"/elements/card-1","value":{"type":"Card","props":{"title":"Market Data Unavailable","description":"Unable to fetch live data"},"children":["text-1"]}}',
      '{"op":"add","path":"/elements/text-1","value":{"type":"Text","props":{"content":"Could not connect to market data APIs. Please check your internet connection and try again."},"children":[]}}',
    ].join("\n");
    return streamSpec(DEMO);
  }
}

export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch (error) {
    console.error("Unhandled /api/generate error:", error);
    return streamStatusSpec(
      "Generation Failed",
      "The server hit an unexpected error while building your dashboard."
    );
  }
}
