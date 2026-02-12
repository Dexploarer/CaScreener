import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  getBalance,
  getTransactionsForAddress,
  getTokenAccounts,
  getAssetsByOwner,
  LAMPORTS_PER_SOL,
} from "@/lib/helius/client";
import { isValidSolanaAddress } from "@/lib/helius/validation";
import type {
  LookupResult,
  WalletLookupResult,
  TransactionLookupResult,
  TokenLookupResult,
  NftLookupResult,
} from "@/lib/helius/types";
import {
  buildStatusSpec,
  streamFilteredSpecResponse,
  streamSpec,
} from "@/lib/specstream/stream";

function isWalletLookup(r: LookupResult): r is WalletLookupResult {
  return r.resultType === "wallet";
}
function isTransactionLookup(r: LookupResult): r is TransactionLookupResult {
  return r.resultType === "transaction";
}
function isTokenLookup(r: LookupResult): r is TokenLookupResult {
  return r.resultType === "token";
}

export const maxDuration = 30;

const ROUTE_FALLBACK_SPEC = buildStatusSpec(
  "Structured UI Fallback",
  "Recovered from unstructured model output",
  "Re-run this dashboard prompt for a richer render."
);

function streamRouteStatus(
  title: string,
  description: string,
  note = "Try again in a moment."
): Response {
  return streamSpec(buildStatusSpec(title, description, note));
}

const SERVER_SYSTEM_PROMPT = `# Component Catalog (SpecStream)

## Available Components
- Card: title (string), description (string|null). Container with optional title.
- Button: label (string), action (string|null), params (object|null). Use action "navigate" for links; handler will open URL.
- Text: content (string). Text paragraph.
- Stack: gap ("sm"|"md"|"lg"), direction ("vertical"|"horizontal"). Layout. Slots: default.
- Metric: label (string), value (string), format ("currency"|"percent"|"number"|null).
- TextField: label, valuePath, placeholder, checks, validateOn.

## Rules
- Output valid SpecStream JSONL: one JSON object per line.
- Each line: { "op": "add" or "replace", "path": "/path", "value": ... }. Use "replace" for /root.
- Start with replace /root then add /elements/*. Use keys like card-1, text-1, button-1, metric-1.
- Only use the components listed above.`;

function getModel(provider: string) {
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (provider === "anthropic" && anthropicKey) {
    return { provider: "anthropic" as const, key: anthropicKey };
  }
  if (openaiKey) {
    return { provider: "openai" as const, key: openaiKey };
  }
  if (anthropicKey) {
    return { provider: "anthropic" as const, key: anthropicKey };
  }
  return null;
}

export async function POST(req: Request) {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    return streamRouteStatus(
      "Helius API Key Missing",
      "HELIUS_API_KEY is not configured for wallet intelligence.",
      "Set Helius credentials and retry."
    );
  }

  const { rateLimit: rateLimitFn, getClientIdentifier: getClientId } = await import("@/lib/rate-limit");
  const id = getClientId(req);
  const limiter = rateLimitFn(id, "helius-generate");
  if (!limiter.ok) {
    const retryAfter = Math.ceil(limiter.resetIn / 1000);
    return streamRouteStatus(
      "Rate Limited",
      `Too many dashboard generation requests. Retry after ${retryAfter}s.`
    );
  }

  let body: {
    address?: string;
    provider?: string;
    analytics?: { address: string; solBalance: number; transactionCount: number; tokenCount: number; nftCount: number };
    followUpPrompt?: string;
    currentSpec?: { root?: string; elements?: Record<string, unknown> };
    lookupResult?: LookupResult;
  };
  try {
    body = await req.json();
  } catch {
    return streamRouteStatus(
      "Invalid Request",
      "The request body could not be parsed as JSON."
    );
  }

  const followUpPrompt = typeof body.followUpPrompt === "string" ? body.followUpPrompt.trim() : undefined;
  const currentSpec = body.currentSpec && typeof body.currentSpec === "object" ? body.currentSpec : undefined;
  const lookupResult = body.lookupResult && typeof body.lookupResult === "object" && typeof (body.lookupResult as LookupResult).resultType === "string"
    ? (body.lookupResult as LookupResult)
    : undefined;

  const provider = body.provider ?? "openai";
  const modelConfig = getModel(provider);
  if (!modelConfig) {
    return streamRouteStatus(
      "AI Provider Missing",
      "Set OPENAI_API_KEY or ANTHROPIC_API_KEY for generated dashboards."
    );
  }

  let explorerUrl: string;
  let contextBlock: string;
  let initialPrompt: string;

  if (lookupResult && isWalletLookup(lookupResult)) {
    const rawAddress = lookupResult.address.trim();
    if (!isValidSolanaAddress(rawAddress)) {
      return streamRouteStatus(
        "Invalid Wallet Address",
        "The lookup payload contains an invalid Solana address."
      );
    }
    explorerUrl = `https://explorer.solana.com/address/${rawAddress}`;
    contextBlock = `- Address: ${rawAddress}
- SOL balance: ${lookupResult.solBalance.toFixed(4)} SOL
- Recent transactions: ${lookupResult.transactionCount}
- Token accounts: ${lookupResult.tokenCount}
- NFTs / digital assets: ${lookupResult.nftCount}`;
    initialPrompt = `Create a Solana wallet dashboard as SpecStream JSONL.

Wallet data:
- ${contextBlock}

Requirements:
- Use a Card as root with a title like "Wallet Dashboard" and short description.
- Include Metrics for SOL balance, transaction count, token count, NFT count (use format "number" or "currency" where appropriate).
- Include a Text showing the wallet address (shortened is ok).
- Include a Button with label "View on Solana Explorer", action "navigate", and params {"url":"${explorerUrl}"}.
- Use Stack with vertical layout and gap "md" to organize content.
Output only the JSONL lines, no other text.`;
  } else if (lookupResult && isTransactionLookup(lookupResult)) {
    explorerUrl = `https://explorer.solana.com/tx/${lookupResult.signature}`;
    const blockTimeStr = lookupResult.blockTime != null ? new Date(lookupResult.blockTime * 1000).toISOString() : "—";
    contextBlock = `- Signature: ${lookupResult.signature}
- Slot: ${lookupResult.slot}
- Block time: ${blockTimeStr}
- Fee (lamports): ${lookupResult.fee ?? "—"}
- Fee payer: ${lookupResult.feePayer ?? "—"}
- Status: ${lookupResult.err ? "failed" : "success"}`;
    initialPrompt = `Create a Solana transaction details dashboard as SpecStream JSONL.

Transaction data:
- ${contextBlock}

Requirements:
- Use a Card as root with title "Transaction" and short description.
- Include Metrics for slot, fee (format "number"), and status.
- Include a Text showing the signature (shortened is ok).
- Include a Button with label "View on Solana Explorer", action "navigate", and params {"url":"${explorerUrl}"}.
- Use Stack with vertical layout and gap "md".
Output only the JSONL lines, no other text.`;
  } else if (lookupResult && isTokenLookup(lookupResult)) {
    explorerUrl = `https://explorer.solana.com/address/${lookupResult.id}`;
    contextBlock = `- Mint/Token ID: ${lookupResult.id}
- Name: ${lookupResult.name ?? "—"}
- Symbol: ${lookupResult.symbol ?? "—"}
- Decimals: ${lookupResult.decimals ?? "—"}`;
    initialPrompt = `Create a Solana token dashboard as SpecStream JSONL.

Token data:
- ${contextBlock}

Requirements:
- Use a Card as root with title like "Token" and short description.
- Include Metrics or Text for name, symbol, decimals.
- Include a Text showing the mint address (shortened is ok).
- Include a Button with label "View on Solana Explorer", action "navigate", and params {"url":"${explorerUrl}"}.
- Use Stack with vertical layout and gap "md".
Output only the JSONL lines, no other text.`;
  } else if (lookupResult && (lookupResult as NftLookupResult).resultType === "nft") {
    const nft = lookupResult as NftLookupResult;
    explorerUrl = `https://explorer.solana.com/address/${nft.id}`;
    contextBlock = `- Asset ID: ${nft.id}
- Name: ${nft.name ?? "—"}
- Symbol: ${nft.symbol ?? "—"}
- Interface: ${nft.interface ?? "—"}`;
    initialPrompt = `Create a Solana NFT/asset dashboard as SpecStream JSONL.

NFT data:
- ${contextBlock}

Requirements:
- Use a Card as root with title like "NFT" and short description.
- Include Text or Metrics for name, symbol, interface.
- Include a Text showing the asset ID (shortened is ok).
- Include a Button with label "View on Solana Explorer", action "navigate", and params {"url":"${explorerUrl}"}.
- Use Stack with vertical layout and gap "md".
Output only the JSONL lines, no other text.`;
  } else {
    const rawAddress = (body.analytics?.address ?? body.address)?.trim();
    if (!rawAddress || !isValidSolanaAddress(rawAddress)) {
      return streamRouteStatus(
        "Address Required",
        "Provide a valid Solana address or lookupResult for dashboard generation."
      );
    }
    let solBalance: number;
    let txCount: number;
    let tokenCount: number;
    let nftCount: number;
    const pre = body.analytics;
    if (pre && pre.address === rawAddress && typeof pre.solBalance === "number" && typeof pre.transactionCount === "number" && typeof pre.tokenCount === "number" && typeof pre.nftCount === "number") {
      solBalance = pre.solBalance;
      txCount = pre.transactionCount;
      tokenCount = pre.tokenCount;
      nftCount = pre.nftCount;
    } else {
      try {
        const [balance, txRes, tokenRes, assetsRes] = await Promise.all([
          getBalance(apiKey, rawAddress),
          getTransactionsForAddress(apiKey, rawAddress, { limit: 25, transactionDetails: "signatures" }),
          getTokenAccounts(apiKey, rawAddress, { limit: 100 }),
          getAssetsByOwner(apiKey, rawAddress, { limit: 50 }).catch(() => ({ items: [], total: 0 })),
        ]);
        solBalance = balance / LAMPORTS_PER_SOL;
        txCount = (txRes.data ?? []).length;
        tokenCount = tokenRes.total ?? 0;
        nftCount = assetsRes.total ?? 0;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return streamRouteStatus(
          "Helius Request Failed",
          "Failed to fetch wallet data from Helius.",
          message
        );
      }
    }
    explorerUrl = `https://explorer.solana.com/address/${rawAddress}`;
    contextBlock = `- Address: ${rawAddress}
- SOL balance: ${solBalance.toFixed(4)} SOL
- Recent transactions (last 25): ${txCount}
- Token accounts: ${tokenCount}
- NFTs / digital assets: ${nftCount}`;
    initialPrompt = `Create a Solana wallet dashboard as SpecStream JSONL.

Wallet data:
- ${contextBlock}

Requirements:
- Use a Card as root with a title like "Wallet Dashboard" and short description.
- Include Metrics for SOL balance, transaction count, token count, NFT count (use format "number" or "currency" where appropriate).
- Include a Text showing the wallet address (shortened is ok).
- Include a Button with label "View on Solana Explorer", action "navigate", and params {"url":"${explorerUrl}"}.
- Use Stack with vertical layout and gap "md" to organize content.
Output only the JSONL lines, no other text.`;
  }

  const userPrompt = followUpPrompt
    ? `The user wants a refined or different view of the same data. Their request: "${followUpPrompt}"

Data (same as before):
${contextBlock}
${currentSpec?.root ? `\nCurrent dashboard spec (for reference; you may replace it entirely with a new view that fulfills their request):\n${JSON.stringify(currentSpec)}` : ""}

Create an updated SpecStream JSONL that fulfills the user's request. Keep a Button "View on Solana Explorer" with action "navigate" and params {"url":"${explorerUrl}"}. Use only Card, Stack, Text, Metric, Button. Output only the JSONL lines, no other text.`
    : initialPrompt;

  const systemPrompt = SERVER_SYSTEM_PROMPT;

  try {
    if (modelConfig.provider === "openai") {
      const openai = createOpenAI({ apiKey: modelConfig.key });
      const result = streamText({
        model: openai("gpt-4o-mini"),
        system: systemPrompt,
        prompt: userPrompt,
      });
      const textStream = result.toTextStreamResponse();
      return streamFilteredSpecResponse(textStream.body, {
        fallbackSpec: ROUTE_FALLBACK_SPEC,
      });
    }

    const anthropic = createAnthropic({ apiKey: modelConfig.key });
    const result = streamText({
      model: anthropic("claude-3-5-haiku-20241022"),
      system: systemPrompt,
      prompt: userPrompt,
    });
    const textStream = result.toTextStreamResponse();
    return streamFilteredSpecResponse(textStream.body, {
      fallbackSpec: ROUTE_FALLBACK_SPEC,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected model invocation failure.";
    return streamRouteStatus("Generation Failed", message);
  }
}
