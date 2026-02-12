import { PredictionMarket, PredictionPlatform, clamp, toYesNoPrices } from "./types";

const DEFAULT_POLYMARKET_BASE = "https://gamma-api.polymarket.com";

function getBase(): string {
  const base = process.env.POLYMARKET_API_BASE || DEFAULT_POLYMARKET_BASE;
  return base.replace(/\/$/, "");
}

type RawPolymarket = {
  id: string;
  question: string;
  slug: string;
  category?: string;
  endDate?: string;
  volume?: string | number;
  volume24hr?: number;
  liquidityNum?: number;
  outcomePrices?: string | number[] | null;
  active?: boolean;
  closed?: boolean;
};

type RawPolymarketEvent = {
  id: string;
  title: string;
  slug: string;
  description?: string;
  active?: boolean;
  closed?: boolean;
  volume?: number;
  volume24hr?: number;
  liquidity?: number;
  tags?: { label: string; slug: string }[];
  markets: RawPolymarket[];
};

function parseOutcomePrices(raw: RawPolymarket["outcomePrices"]): number | null {
  if (raw == null) return null;
  try {
    if (Array.isArray(raw)) {
      const p = Number(raw[0]);
      return Number.isFinite(p) ? p : null;
    }
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const p = Number(parsed[0]);
        return Number.isFinite(p) ? p : null;
      }
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

function toPredictionMarket(m: RawPolymarket): PredictionMarket {
  const platform: PredictionPlatform = "polymarket";
  const yesRaw = parseOutcomePrices(m.outcomePrices);
  const { yesPrice, noPrice } = toYesNoPrices(yesRaw ?? 0.5);
  const volumeNum =
    typeof m.volume === "string" ? Number(m.volume) : typeof m.volume === "number" ? m.volume : undefined;

  return {
    id: m.id,
    platform,
    question: m.question,
    yesPrice,
    noPrice,
    volume: volumeNum,
    volume24h: m.volume24hr,
    liquidity: m.liquidityNum,
    category: m.category,
    endDate: m.endDate,
    url: m.slug ? `https://polymarket.com/market/${m.slug}` : undefined,
    isResolved: m.closed ?? false,
    spread: undefined,
  };
}

async function fetchMarkets(params: {
  limit?: number;
  offset?: number;
  closed?: boolean;
  active?: boolean;
  volumeNumMin?: number;
  order?: string;
  ascending?: boolean;
} = {}): Promise<RawPolymarket[]> {
  const url = new URL(`${getBase()}/markets`);
  if (params.limit != null) url.searchParams.set("limit", String(params.limit));
  if (params.offset != null) url.searchParams.set("offset", String(params.offset));
  if (params.closed != null) url.searchParams.set("closed", String(params.closed));
  if (params.active != null) url.searchParams.set("active", String(params.active));
  if (params.volumeNumMin != null) url.searchParams.set("volume_num_min", String(params.volumeNumMin));
  if (params.order) url.searchParams.set("order", params.order);
  if (params.ascending != null) url.searchParams.set("ascending", String(params.ascending));

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Polymarket markets ${res.status}: ${text}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data as RawPolymarket[];
}

async function fetchEvents(params: {
  limit?: number;
  offset?: number;
  closed?: boolean;
  active?: boolean;
} = {}): Promise<RawPolymarketEvent[]> {
  const url = new URL(`${getBase()}/events`);
  if (params.limit != null) url.searchParams.set("limit", String(params.limit));
  if (params.offset != null) url.searchParams.set("offset", String(params.offset));
  if (params.closed != null) url.searchParams.set("closed", String(params.closed));
  if (params.active != null) url.searchParams.set("active", String(params.active));

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data as RawPolymarketEvent[];
}

export async function searchMarkets(options: {
  query?: string;
  limit?: number;
  volumeMin?: number;
} = {}): Promise<PredictionMarket[]> {
  const { query, limit = 50, volumeMin } = options;
  const raw = await fetchMarkets({
    limit: clamp(limit, 1, 200),
    closed: false,
    volumeNumMin: volumeMin,
  });
  const markets = raw.map(toPredictionMarket);
  if (!query) return markets;
  const q = query.toLowerCase();
  return markets.filter((m) => m.question.toLowerCase().includes(q) || (m.category ?? "").toLowerCase().includes(q));
}

export async function getMarketBySlug(slug: string): Promise<PredictionMarket | null> {
  const trimmed = slug.trim();
  if (!trimmed) return null;
  const url = new URL(`${getBase()}/markets`);
  url.searchParams.set("slug", trimmed);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) return null;
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data) || data.length === 0) return null;
  return toPredictionMarket(data[0] as RawPolymarket);
}

export async function getTrendingMarkets(limit = 20): Promise<PredictionMarket[]> {
  const raw = await fetchMarkets({
    limit: clamp(limit, 1, 100),
    closed: false,
  });
  const markets = raw.map(toPredictionMarket);
  markets.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
  return markets;
}

/**
 * Fetch diverse markets for custom dashboards. Uses multiple strategies:
 * - Paginated fetches with different offsets for variety
 * - Client-side keyword filtering for topic relevance
 * - Volume-based sorting for significance
 */
export async function getDiverseMarkets(options: {
  keywords?: string[];
  limit?: number;
} = {}): Promise<{
  topByVolume: PredictionMarket[];
  recentlyAdded: PredictionMarket[];
  matched: PredictionMarket[];
  highConfidence: PredictionMarket[];
  closeCall: PredictionMarket[];
}> {
  const { keywords = [], limit = 100 } = options;
  const halfLimit = Math.ceil(limit / 2);

  // Fetch two different pages for variety, plus events for grouped context
  const [page1, page2, events] = await Promise.all([
    fetchMarkets({ limit: halfLimit, closed: false, offset: 0 }).catch(() => []),
    fetchMarkets({ limit: halfLimit, closed: false, offset: halfLimit }).catch(() => []),
    fetchEvents({ limit: 30, closed: false, active: true }).catch(() => []),
  ]);

  // Deduplicate
  const seen = new Set<string>();
  const allRaw: RawPolymarket[] = [];
  for (const m of [...page1, ...page2]) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      allRaw.push(m);
    }
  }
  // Add markets from events
  for (const ev of events) {
    for (const m of ev.markets ?? []) {
      if (!seen.has(m.id) && !m.closed) {
        seen.add(m.id);
        allRaw.push(m);
      }
    }
  }

  const allMarkets = allRaw.map(toPredictionMarket);

  // Top by volume
  const topByVolume = [...allMarkets]
    .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))
    .slice(0, 15);

  // Recently added (by end date furthest out — proxy for newer)
  const recentlyAdded = [...allMarkets]
    .filter((m) => m.endDate)
    .sort((a, b) => {
      const da = new Date(a.endDate!).getTime();
      const db = new Date(b.endDate!).getTime();
      return db - da;
    })
    .slice(0, 10);

  // Keyword-matched markets
  let matched: PredictionMarket[] = [];
  if (keywords.length > 0) {
    const lowerKeywords = keywords.map((k) => k.toLowerCase());
    matched = allMarkets
      .filter((m) => {
        const q = m.question.toLowerCase();
        const cat = (m.category ?? "").toLowerCase();
        return lowerKeywords.some((kw) => q.includes(kw) || cat.includes(kw));
      })
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, 15);
  }

  // High confidence (YES > 80% or < 20%)
  const highConfidence = allMarkets
    .filter((m) => m.yesPrice > 0.8 || m.yesPrice < 0.2)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, 10);

  // Close calls (YES between 40-60%)
  const closeCall = allMarkets
    .filter((m) => m.yesPrice >= 0.35 && m.yesPrice <= 0.65)
    .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))
    .slice(0, 10);

  return { topByVolume, recentlyAdded, matched, highConfidence, closeCall };
}

/**
 * Extract meaningful search keywords from a user prompt.
 * Removes common filler words and Polymarket-specific terms.
 */
export function extractPolymarketKeywords(prompt: string): string[] {
  const stopWords = new Set([
    "polymarket", "prediction", "market", "markets", "odds", "betting",
    "probability", "forecast", "show", "get", "find", "me", "the", "top",
    "trending", "what", "are", "is", "about", "on", "for", "in", "of",
    "will", "can", "do", "how", "which", "tell", "give", "list",
    "current", "latest", "best", "most", "popular", "active",
    "a", "an", "and", "or", "but", "to", "with", "at", "by", "from",
  ]);

  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

/**
 * Serialize Polymarket data for LLM context injection.
 * Returns a human-readable summary of all market data.
 */
export function serializeMarketsForLLM(data: {
  topByVolume: PredictionMarket[];
  recentlyAdded: PredictionMarket[];
  matched: PredictionMarket[];
  highConfidence: PredictionMarket[];
  closeCall: PredictionMarket[];
  keywords: string[];
  prompt: string;
}): string {
  const { topByVolume, recentlyAdded, matched, highConfidence, closeCall, keywords, prompt } = data;
  const parts: string[] = [];

  parts.push(`User asked: "${prompt}"`);
  if (keywords.length > 0) {
    parts.push(`Detected topics: ${keywords.join(", ")}`);
  }

  const formatMarket = (m: PredictionMarket): string => {
    const yesPct = (m.yesPrice * 100).toFixed(1);
    const noPct = (m.noPrice * 100).toFixed(1);
    const vol = m.volume ? `$${(m.volume / 1000).toFixed(0)}K` : "n/a";
    const vol24 = m.volume24h ? `$${(m.volume24h / 1000).toFixed(0)}K` : "n/a";
    const liq = m.liquidity ? `$${(m.liquidity / 1000).toFixed(0)}K` : "n/a";
    return `  - "${m.question}" | YES: ${yesPct}% | NO: ${noPct}% | Vol: ${vol} | 24h: ${vol24} | Liq: ${liq}`;
  };

  if (matched.length > 0) {
    parts.push(`\nMARKETS MATCHING USER QUERY (${matched.length} found):`);
    matched.forEach((m) => parts.push(formatMarket(m)));
  }

  parts.push(`\nTOP MARKETS BY 24H VOLUME (${topByVolume.length}):`);
  topByVolume.forEach((m) => parts.push(formatMarket(m)));

  if (highConfidence.length > 0) {
    parts.push(`\nHIGH CONFIDENCE MARKETS (YES >80% or <20%) (${highConfidence.length}):`);
    highConfidence.forEach((m) => parts.push(formatMarket(m)));
  }

  if (closeCall.length > 0) {
    parts.push(`\nCLOSE CALL MARKETS (YES 35-65%) (${closeCall.length}):`);
    closeCall.forEach((m) => parts.push(formatMarket(m)));
  }

  if (recentlyAdded.length > 0) {
    parts.push(`\nNEWEST MARKETS (${recentlyAdded.length}):`);
    recentlyAdded.forEach((m) => parts.push(formatMarket(m)));
  }

  const totalMarkets = new Set([
    ...topByVolume.map((m) => m.id),
    ...recentlyAdded.map((m) => m.id),
    ...matched.map((m) => m.id),
    ...highConfidence.map((m) => m.id),
    ...closeCall.map((m) => m.id),
  ]).size;

  parts.push(`\nTOTAL UNIQUE MARKETS: ${totalMarkets}`);

  return parts.join("\n");
}

