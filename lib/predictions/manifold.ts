import { PredictionMarket, PredictionPlatform, clamp, toYesNoPrices } from "./types";

const DEFAULT_MANIFOLD_BASE = "https://api.manifold.markets";

function getBase(): string {
  const base = process.env.MANIFOLD_API_BASE || DEFAULT_MANIFOLD_BASE;
  return base.replace(/\/$/, "");
}

type LiteMarket = {
  id: string;
  question: string;
  url: string;
  probability: number;
  volume: number;
  volume24Hours?: number;
  totalLiquidity?: number;
  outcomeType: string;
  isResolved: boolean;
  closeTime?: number;
  createdTime?: number;
};

async function fetchMarkets(params: { limit?: number; sort?: string; term?: string } = {}): Promise<LiteMarket[]> {
  const { limit, sort, term } = params;
  const url = new URL(`${getBase()}/v0/markets`);
  if (limit != null) url.searchParams.set("limit", String(limit));
  if (sort) url.searchParams.set("sort", sort);
  if (term) url.searchParams.set("term", term);

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Manifold markets ${res.status}: ${text}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data as LiteMarket[];
}

function toPredictionMarket(m: LiteMarket): PredictionMarket {
  const platform: PredictionPlatform = "manifold";
  const { yesPrice, noPrice } = toYesNoPrices(m.probability ?? 0.5);
  return {
    id: m.id,
    platform,
    question: m.question,
    yesPrice,
    noPrice,
    volume: m.volume,
    volume24h: m.volume24Hours,
    liquidity: m.totalLiquidity,
    category: undefined,
    endDate: m.closeTime ? new Date(m.closeTime).toISOString() : undefined,
    url: m.url,
    isResolved: m.isResolved,
    spread: undefined,
  };
}

export async function searchMarkets(options: {
  query?: string;
  limit?: number;
  sort?: "created-time" | "updated-time" | "last-bet-time" | "last-comment-time";
} = {}): Promise<PredictionMarket[]> {
  const { query, limit = 50, sort = "created-time" } = options;
  const liteMarkets = await fetchMarkets({
    limit: clamp(limit, 1, 1000),
    sort,
    term: query,
  });
  return liteMarkets
    .filter((m) => m.outcomeType === "BINARY")
    .map(toPredictionMarket);
}

export async function getMarketById(id: string): Promise<PredictionMarket | null> {
  const trimmed = id.trim();
  if (!trimmed) return null;
  const url = `${getBase()}/v0/market/${encodeURIComponent(trimmed)}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) return null;
  const m = (await res.json()) as LiteMarket;
  if (!m || m.outcomeType !== "BINARY") return null;
  return toPredictionMarket(m);
}

export async function getTrendingMarkets(limit = 20): Promise<PredictionMarket[]> {
  const liteMarkets = await fetchMarkets({
    limit: clamp(limit, 1, 200),
    sort: "last-bet-time",
  });
  return liteMarkets
    .filter((m) => m.outcomeType === "BINARY")
    .map(toPredictionMarket);
}

