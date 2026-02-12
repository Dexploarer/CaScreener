import type { TokenLookupResult } from "@/lib/helius/types";
import { isValidSolanaAddress } from "@/lib/helius/validation";

type ConvexFunctionKind = "action" | "query" | "mutation";

type TrackOptions = {
  source?: string;
  namespace?: string;
};

type RagSearchInput = {
  query: string;
  namespace?: string;
  symbol?: string;
  mint?: string;
  limit?: number;
  vectorScoreThreshold?: number;
};

type RagSearchResponse = {
  namespace: string;
  text: string;
  resultCount: number;
  results: unknown[];
  entries: unknown[];
  usage: unknown;
};

export type WatchlistChannelConfig = {
  web?: boolean;
  telegramChatId?: string;
  discordWebhookUrl?: string;
};

export type WatchlistItem = {
  id: string;
  userId: string;
  ticker: string;
  mint?: string;
  web: boolean;
  telegramChatId?: string;
  discordWebhookUrl?: string;
  lastSeenSuspicious: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  lastAlertAt?: number;
};

export type WatchAlertItem = {
  id: string;
  userId: string;
  ticker: string;
  mint?: string;
  previousSuspicious: number;
  currentSuspicious: number;
  message: string;
  createdAt: number;
  channels: string[];
};

export type MetaRadarCluster = {
  symbol: string;
  clusterScore: number;
  sampleSize: number;
  latestUpdatedAt: number;
  suspiciousRatio: number;
  acceleration: number;
  avgTrustScore?: number;
  topMints: string[];
  summary: string;
};

export type TelemetryEventInput = {
  event: string;
  userId?: string;
  sessionId?: string;
  page?: string;
  properties?: Record<string, unknown>;
};

export type ShareMediaMirrorJob = {
  jobId: string;
  status: "queued" | "processing" | "mirrored" | "failed";
  workflowId?: string;
  sourceUrl?: string;
  tokenId?: string;
  tokenSymbol?: string;
  requestedBy?: string;
  r2Key?: string;
  r2Url?: string;
  sizeBytes?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type TokenIntelHydrationResult = {
  generatedAt: string;
  durationMs: number;
  query: string;
  symbol?: string;
  mint?: string;
  namespace?: string;
  narrativeHits: number;
  narrativeSummary: string;
  symbolDocsCount: number;
  suspiciousDocsCount: number;
  watchlistCount: number;
  topClusters: Array<{
    symbol: string;
    clusterScore: number;
    suspiciousRatio: number;
    acceleration: number;
    summary: string;
  }>;
  telemetryTop: Array<{ event: string; count: number }>;
  errors: string[];
};

export type TokenIntelHydrationJob = {
  jobId: string;
  status: string;
  workflowId: string;
};

export type TokenIntelHydrationRun = {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed";
  workflowId?: string;
  query: string;
  symbol?: string;
  mint?: string;
  namespace?: string;
  requestedBy?: string;
  result?: TokenIntelHydrationResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

function getConvexUrl(): string | null {
  const raw = process.env.CONVEX_URL?.trim() || process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

function getConvexNamespace(override?: string): string {
  return override?.trim() || process.env.CONVEX_MEME_NAMESPACE?.trim() || "solana-memecoins";
}

function getConvexDeployKey(): string | null {
  return process.env.CONVEX_DEPLOY_KEY?.trim() || null;
}

function getConvexRequestTimeoutMs(): number {
  const raw = process.env.CONVEX_REQUEST_TIMEOUT_MS?.trim();
  if (!raw) return 2_500;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 2_500;
  return Math.floor(parsed);
}

function normalizeSymbol(value: string | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function toUniqueStrings(input: Array<string | undefined> | undefined, max = 50): string[] {
  if (!input?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const value = raw?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

export function computeRiskBand(token: TokenLookupResult): "low" | "medium" | "high" {
  const suspicious = token.suspiciousTickerCount ?? 0;
  const total = token.sameTickerCount ?? token.sameTickerTokens?.length ?? 0;
  if (suspicious >= 5) return "high";
  if (total > 0 && suspicious / total >= 0.4) return "high";
  if (suspicious >= 2) return "medium";
  if (
    token.sameTickerTokens?.some((match) => match.risk === "high" || match.risk === "medium")
  ) {
    return "medium";
  }
  return "low";
}

export function buildNarrativeForTokenMeta(token: TokenLookupResult): string {
  const symbol = normalizeSymbol(token.symbol);
  const lines: string[] = [];
  lines.push(`Token: ${symbol || "UNKNOWN"}${token.name ? ` (${token.name})` : ""}`);
  lines.push(`Mint: ${token.id}`);
  lines.push(`Lookup mode: ${token.lookupMode ?? "mint"}`);
  if (token.searchedTicker) lines.push(`Search ticker: ${normalizeSymbol(token.searchedTicker)}`);
  lines.push(`Same-ticker matches on Solana: ${token.sameTickerCount ?? token.sameTickerTokens?.length ?? 0}`);
  lines.push(`Suspicious matches (medium/high): ${token.suspiciousTickerCount ?? 0}`);
  lines.push(`Image sources collected: ${token.sameTickerImageCount ?? token.imageUris?.length ?? 0}`);
  const matches = token.sameTickerTokens ?? [];
  if (matches.length > 0) {
    lines.push("Top same-ticker candidates:");
    for (const match of matches.slice(0, 10)) {
      const reason = match.riskReasons.length > 0 ? match.riskReasons.join(", ") : "no flags";
      lines.push(
        `- ${match.symbol}${match.name ? ` (${match.name})` : ""} | mint=${match.mint} | risk=${match.risk} | liq=${match.liquidityUsd ?? "n/a"} | vol24=${match.volume24hUsd ?? "n/a"} | reasons=${reason}`
      );
    }
  }
  return lines.join("\n").slice(0, 8_000);
}

export function buildMetaTagsForToken(token: TokenLookupResult): string[] {
  const symbol = normalizeSymbol(token.symbol);
  const tags: string[] = ["solana", "memecoin", "ticker-scan"];
  if (symbol) tags.push(`symbol:${symbol.toLowerCase()}`);
  if (token.lookupMode === "ticker") tags.push("lookup:ticker");
  if (token.lookupMode === "mint") tags.push("lookup:mint");

  const suspicious = token.suspiciousTickerCount ?? 0;
  if (suspicious > 0) tags.push("clone-risk");
  if (suspicious >= 2) tags.push("clone-risk:medium");
  if (suspicious >= 5) tags.push("clone-risk:high");
  if ((token.sameTickerCount ?? 0) >= 10) tags.push("crowded-ticker");

  for (const match of token.sameTickerTokens ?? []) {
    for (const reason of match.riskReasons) {
      const normalized = reason
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (normalized) tags.push(`risk:${normalized}`);
    }
  }
  return toUniqueStrings(tags, 30);
}

async function callConvexFunction<T>(
  kind: ConvexFunctionKind,
  path: string,
  args: Record<string, unknown>
): Promise<T> {
  const convexUrl = getConvexUrl();
  if (!convexUrl) throw new Error("CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) is not configured");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const deployKey = getConvexDeployKey();
  if (deployKey) {
    headers.Authorization = `Convex ${deployKey}`;
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), getConvexRequestTimeoutMs());
  let response: Response;
  try {
    response = await fetch(`${convexUrl}/api/${kind}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ path, args }),
      cache: "no-store",
      signal: abortController.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Convex ${kind} ${path} timed out`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const json = (await response.json().catch(() => null)) as
    | { status?: string; value?: T; errorMessage?: string }
    | null;
  if (!response.ok || !json || json.status === "error") {
    const details = json && "errorMessage" in json ? json.errorMessage : response.statusText;
    throw new Error(`Convex ${kind} ${path} failed: ${details || "unknown error"}`);
  }

  return json.value as T;
}

export function isConvexTrackingEnabled(): boolean {
  return !!getConvexUrl();
}

export async function trackTokenMetaInConvex(
  token: TokenLookupResult,
  options: TrackOptions = {}
): Promise<boolean> {
  if (!isConvexTrackingEnabled()) return false;
  if (!token.id?.trim()) return false;
  if (!isValidSolanaAddress(token.id.trim())) return false;

  const symbol = normalizeSymbol(token.symbol);
  const tags = buildMetaTagsForToken(token);
  const narrative = buildNarrativeForTokenMeta(token);
  const imageUris = toUniqueStrings(
    token.imageUris ?? [token.imageUri],
    50
  );

  await callConvexFunction<{ tracked: boolean }>(
    "action",
    "memeMetaAgent:ingestTokenMeta",
    {
      mint: token.id.trim(),
      symbol: symbol || "UNKNOWN",
      name: token.name?.trim() || undefined,
      canonicalMint: token.canonicalMint?.trim() || undefined,
      lookupMode: token.lookupMode ?? "mint",
      searchedTicker: normalizeSymbol(token.searchedTicker) || undefined,
      sameTickerCount: token.sameTickerCount ?? token.sameTickerTokens?.length ?? 0,
      suspiciousTickerCount: token.suspiciousTickerCount ?? 0,
      sameTickerImageCount: token.sameTickerImageCount ?? imageUris.length,
      trustScore: token.trustScore?.score,
      riskBand: computeRiskBand(token),
      imageUris,
      narrative,
      metaTags: tags,
      source: options.source ?? "helius-lookup",
      namespace: getConvexNamespace(options.namespace),
    }
  );

  return true;
}

export async function searchTokenNarrativesInConvex(
  input: RagSearchInput
): Promise<RagSearchResponse> {
  return callConvexFunction<RagSearchResponse>(
    "action",
    "memeMetaAgent:searchTokenNarratives",
    {
      query: input.query.trim(),
      namespace: getConvexNamespace(input.namespace),
      symbol: normalizeSymbol(input.symbol) || undefined,
      mint: input.mint?.trim() || undefined,
      limit: input.limit,
      vectorScoreThreshold: input.vectorScoreThreshold,
    }
  );
}

export async function processWatchAlertsForTokenInConvex(
  token: TokenLookupResult
): Promise<void> {
  if (!isConvexTrackingEnabled()) return;
  if (!token.symbol?.trim()) return;
  await callConvexFunction<{ processed: number }>(
    "action",
    "watchlistsNode:evaluateTokenForAlerts",
    {
      symbol: normalizeSymbol(token.symbol),
      mint: token.id.trim(),
      suspiciousTickerCount: token.suspiciousTickerCount ?? 0,
      sameTickerCount: token.sameTickerCount ?? token.sameTickerTokens?.length ?? 0,
      trustScore: token.trustScore?.score ?? null,
      pairUrl: token.trustScore?.hardLinks?.pair,
      explorerUrl: token.trustScore?.hardLinks?.mint ?? `https://explorer.solana.com/address/${token.id.trim()}`,
    }
  );
}

export async function subscribeWatchlistInConvex(input: {
  userId: string;
  ticker: string;
  mint?: string;
  channels?: WatchlistChannelConfig;
}): Promise<WatchlistItem> {
  return callConvexFunction<WatchlistItem>("mutation", "watchlists:subscribe", {
    userId: input.userId.trim(),
    ticker: normalizeSymbol(input.ticker),
    mint: input.mint?.trim() || undefined,
    web: input.channels?.web ?? true,
    telegramChatId: input.channels?.telegramChatId?.trim() || undefined,
    discordWebhookUrl: input.channels?.discordWebhookUrl?.trim() || undefined,
  });
}

export async function unsubscribeWatchlistInConvex(input: {
  userId: string;
  ticker: string;
}): Promise<boolean> {
  const out = await callConvexFunction<{ ok: boolean }>(
    "mutation",
    "watchlists:unsubscribe",
    {
      userId: input.userId.trim(),
      ticker: normalizeSymbol(input.ticker),
    }
  );
  return !!out.ok;
}

export async function listWatchlistInConvex(userId: string): Promise<WatchlistItem[]> {
  return callConvexFunction<WatchlistItem[]>("query", "watchlists:listByUser", {
    userId: userId.trim(),
  });
}

export async function listWatchAlertsInConvex(
  userId: string,
  limit = 20
): Promise<WatchAlertItem[]> {
  return callConvexFunction<WatchAlertItem[]>("query", "watchlists:listAlertsByUser", {
    userId: userId.trim(),
    limit,
  });
}

export async function getMetaRadarClustersInConvex(input: {
  limit?: number;
  windowMs?: number;
} = {}): Promise<MetaRadarCluster[]> {
  return callConvexFunction<MetaRadarCluster[]>("query", "metaRadar:listClusters", {
    limit: input.limit ?? 12,
    windowMs: input.windowMs ?? 1000 * 60 * 60 * 24,
  });
}

export async function trackTelemetryInConvex(
  event: TelemetryEventInput
): Promise<boolean> {
  if (!isConvexTrackingEnabled()) return false;
  await callConvexFunction<{ stored: boolean }>("mutation", "telemetry:ingest", {
    event: event.event.trim(),
    userId: event.userId?.trim() || "anonymous",
    sessionId: event.sessionId?.trim() || undefined,
    page: event.page?.trim() || undefined,
    properties: event.properties ?? {},
    ts: Date.now(),
  });
  return true;
}

export async function getTelemetrySummaryInConvex(
  windowMs = 1000 * 60 * 60 * 24
): Promise<Array<{ event: string; count: number }>> {
  return callConvexFunction<Array<{ event: string; count: number }>>(
    "query",
    "telemetry:summarize",
    {
      windowMs,
    }
  );
}

export async function enqueueShareVideoMirrorInConvex(input: {
  sourceUrl: string;
  tokenId?: string;
  tokenSymbol?: string;
  requestedBy?: string;
}): Promise<{ jobId: string; status: string; workflowId: string }> {
  return callConvexFunction<{ jobId: string; status: string; workflowId: string }>(
    "mutation",
    "shareMedia:enqueueVideoMirror",
    {
      sourceUrl: input.sourceUrl.trim(),
      tokenId: input.tokenId?.trim() || undefined,
      tokenSymbol: input.tokenSymbol?.trim() || undefined,
      requestedBy: input.requestedBy?.trim() || undefined,
    }
  );
}

export async function getShareVideoMirrorJobInConvex(
  jobId: string
): Promise<ShareMediaMirrorJob | null> {
  return callConvexFunction<ShareMediaMirrorJob | null>(
    "query",
    "shareMedia:getJobByPublicId",
    {
      jobId: jobId.trim(),
    }
  );
}

export async function enqueueTokenIntelHydrationInConvex(input: {
  query: string;
  symbol?: string;
  mint?: string;
  namespace?: string;
  requestedBy?: string;
}): Promise<TokenIntelHydrationJob> {
  return callConvexFunction<TokenIntelHydrationJob>(
    "mutation",
    "intelWorkflows:enqueueTokenIntelHydration",
    {
      query: input.query.trim(),
      symbol: normalizeSymbol(input.symbol) || undefined,
      mint: input.mint?.trim() || undefined,
      namespace: input.namespace?.trim() || undefined,
      requestedBy: input.requestedBy?.trim() || undefined,
    }
  );
}

export async function getTokenIntelHydrationRunInConvex(
  jobId: string
): Promise<TokenIntelHydrationRun | null> {
  return callConvexFunction<TokenIntelHydrationRun | null>(
    "query",
    "intelWorkflows:getTokenIntelRun",
    {
      jobId: jobId.trim(),
    }
  );
}

export async function getLatestCompletedTokenIntelBySymbolInConvex(
  symbol: string
): Promise<TokenIntelHydrationRun | null> {
  return callConvexFunction<TokenIntelHydrationRun | null>(
    "query",
    "intelWorkflows:getLatestCompletedBySymbol",
    {
      symbol: normalizeSymbol(symbol),
    }
  );
}
