/**
 * CoinGecko API client with in-memory caching.
 * Uses Demo API key if COINGECKO_API_KEY is set, otherwise falls back to free tier.
 */

const CG_API_KEY = process.env.COINGECKO_API_KEY;
const BASE = CG_API_KEY
  ? "https://api.coingecko.com/api/v3"
  : "https://api.coingecko.com/api/v3";
const CACHE_TTL = 60_000; // 1 minute

type CacheEntry = { data: unknown; ts: number };
const cache = new Map<string, CacheEntry>();

async function cachedFetch<T>(key: string, url: string, ttl = CACHE_TTL, bypassCache = false): Promise<T> {
  if (!bypassCache) {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.ts < ttl) return entry.data as T;
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (CG_API_KEY) {
    headers["x-cg-demo-api-key"] = CG_API_KEY;
  }

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}: ${res.statusText}`);
  const data = await res.json();
  cache.set(key, { data, ts: Date.now() });
  return data as T;
}

// ── Types ────────────────────────────────────────────────────────

export type CoinMarketData = {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  price_change_percentage_24h: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  sparkline_in_7d?: { price: number[] };
  ath: number;
  ath_change_percentage: number;
  circulating_supply: number;
  max_supply: number | null;
  high_24h: number;
  low_24h: number;
};

export type GlobalData = {
  total_market_cap: Record<string, number>;
  total_volume: Record<string, number>;
  market_cap_percentage: Record<string, number>;
  market_cap_change_percentage_24h_usd: number;
  active_cryptocurrencies: number;
};

export type TrendingCoinItem = {
  id: string;
  name: string;
  symbol: string;
  market_cap_rank: number | null;
  thumb: string;
  price_btc: number;
  data?: {
    price: number;
    price_change_percentage_24h?: Record<string, number>;
    market_cap?: string;
    total_volume?: string;
    sparkline?: string; // SVG string
  };
};

export type CoinDetail = {
  id: string;
  symbol: string;
  name: string;
  links: {
    homepage: string[];
    twitter_screen_name: string | null;
    telegram_channel_identifier: string | null;
    discord_link: string | null;
    repos_url: {
      github: string[];
    };
  };
  community_score: number;
  developer_score: number;
  market_cap_rank: number;
};

// ── API Functions ────────────────────────────────────────────────

/**
 * Get top coins by market cap with 7d sparkline data.
 */
export async function getTopCoins(limit = 20): Promise<CoinMarketData[]> {
  return cachedFetch<CoinMarketData[]>(
    `top-coins-${limit}`,
    `${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=true&price_change_percentage=7d`
  );
}

/**
 * Get specific coins by IDs (comma-separated).
 */
export async function getCoinsByIds(ids: string[]): Promise<CoinMarketData[]> {
  const key = ids.sort().join(",");
  return cachedFetch<CoinMarketData[]>(
    `coins-${key}`,
    `${BASE}/coins/markets?vs_currency=usd&ids=${key}&sparkline=true&price_change_percentage=7d`
  );
}

/**
 * Get trending coins on CoinGecko (based on search activity).
 */
export async function getTrending(): Promise<TrendingCoinItem[]> {
  const data = await cachedFetch<{ coins: { item: TrendingCoinItem }[] }>(
    "trending",
    `${BASE}/search/trending`
  );
  return (data.coins ?? []).map((c) => c.item);
}

/**
 * Get exhaustive detail for a single coin by ID (socials, github, etc).
 */
export async function getCoinDetail(id: string, bypassCache = false): Promise<CoinDetail> {
  return cachedFetch<CoinDetail>(
    `detail-${id}`,
    `${BASE}/coins/${id}?localization=false&tickers=false&market_data=false&community_data=true&developer_data=true&sparkline=false`,
    CACHE_TTL * 10,
    bypassCache
  );
}

/**
 * Get global crypto market data (total market cap, dominance, etc.).
 */
export async function getGlobalData(): Promise<GlobalData> {
  const data = await cachedFetch<{ data: GlobalData }>("global", `${BASE}/global`);
  return data.data;
}

/**
 * Search coins by query string.
 */
export async function searchCoins(query: string): Promise<{ id: string; name: string; symbol: string; market_cap_rank: number | null }[]> {
  const data = await cachedFetch<{ coins: { id: string; name: string; symbol: string; market_cap_rank: number | null }[] }>(
    `search-${query.toLowerCase()}`,
    `${BASE}/search?query=${encodeURIComponent(query)}`
  );
  return data.coins ?? [];
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Downsample an array to a target number of points (for sparklines).
 */
export function downsample(data: number[], targetPoints: number): number[] {
  if (data.length <= targetPoints) return data;
  const step = data.length / targetPoints;
  return Array.from({ length: targetPoints }, (_, i) =>
    data[Math.floor(i * step)]
  );
}

/**
 * Format a number as compact USD (e.g. $1.23B, $456M).
 */
export function formatUsd(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

/**
 * Format a percentage with sign.
 */
export function formatPct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "N/A";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/**
 * Format a large number compactly.
 */
export function formatCompact(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

/**
 * Resolve common crypto names/tickers to CoinGecko IDs.
 */
export function resolveCoinId(input: string): string | null {
  const map: Record<string, string> = {
    btc: "bitcoin", bitcoin: "bitcoin",
    eth: "ethereum", ethereum: "ethereum",
    sol: "solana", solana: "solana",
    bnb: "binancecoin",
    xrp: "ripple", ripple: "ripple",
    ada: "cardano", cardano: "cardano",
    doge: "dogecoin", dogecoin: "dogecoin",
    dot: "polkadot", polkadot: "polkadot",
    avax: "avalanche-2", avalanche: "avalanche-2",
    matic: "matic-network", polygon: "matic-network",
    link: "chainlink", chainlink: "chainlink",
    uni: "uniswap", uniswap: "uniswap",
    atom: "cosmos", cosmos: "cosmos",
    near: "near",
    apt: "aptos", aptos: "aptos",
    sui: "sui",
    arb: "arbitrum", arbitrum: "arbitrum",
    op: "optimism", optimism: "optimism",
    sei: "sei-network",
    jup: "jupiter-exchange-solana", jupiter: "jupiter-exchange-solana",
    bonk: "bonk",
    wif: "dogwifcoin",
    pepe: "pepe",
    render: "render-token",
    jto: "jito-governance-token",
    pyth: "pyth-network",
    ray: "raydium", raydium: "raydium",
    orca: "orca",
    meme: "memecoin",
    usdt: "tether", tether: "tether",
    usdc: "usd-coin",
  };
  const key = input.toLowerCase().trim();
  return map[key] ?? null;
}

/**
 * Extract coin IDs from a user prompt.
 */
export function extractCoinIds(prompt: string): string[] {
  const words = prompt.toLowerCase().split(/[\s,]+/);
  const ids = new Set<string>();
  for (const word of words) {
    const clean = word.replace(/[^a-z0-9]/g, "");
    const id = resolveCoinId(clean);
    if (id) ids.add(id);
  }
  return [...ids];
}
