import type { PredictionMarket } from "@/lib/predictions/types";

/**
 * Maps token symbols/names to CoinGecko IDs AND prediction market keywords.
 * Used to link crypto prices with prediction market questions.
 */
export const CRYPTO_KEYWORD_MAP: Record<
  string,
  { coingeckoId: string; keywords: string[] }
> = {
  btc: { coingeckoId: "bitcoin", keywords: ["bitcoin", "btc", "bitcoin etf", "btc etf"] },
  eth: { coingeckoId: "ethereum", keywords: ["ethereum", "eth", "ether", "ethereum etf", "eth etf"] },
  sol: { coingeckoId: "solana", keywords: ["solana", "sol", "solana etf", "sol etf"] },
  bnb: { coingeckoId: "binancecoin", keywords: ["binance", "bnb"] },
  xrp: { coingeckoId: "ripple", keywords: ["ripple", "xrp", "xrp etf"] },
  ada: { coingeckoId: "cardano", keywords: ["cardano", "ada"] },
  doge: { coingeckoId: "dogecoin", keywords: ["dogecoin", "doge", "meme coin"] },
  dot: { coingeckoId: "polkadot", keywords: ["polkadot", "dot"] },
  avax: { coingeckoId: "avalanche-2", keywords: ["avalanche", "avax"] },
  matic: { coingeckoId: "matic-network", keywords: ["polygon", "matic"] },
  link: { coingeckoId: "chainlink", keywords: ["chainlink", "link", "oracle"] },
  uni: { coingeckoId: "uniswap", keywords: ["uniswap", "uni", "dex"] },
  atom: { coingeckoId: "cosmos", keywords: ["cosmos", "atom"] },
  near: { coingeckoId: "near", keywords: ["near", "near protocol"] },
  apt: { coingeckoId: "aptos", keywords: ["aptos", "apt"] },
  sui: { coingeckoId: "sui", keywords: ["sui"] },
  arb: { coingeckoId: "arbitrum", keywords: ["arbitrum", "arb", "layer 2", "l2"] },
  op: { coingeckoId: "optimism", keywords: ["optimism", "op"] },
  pepe: { coingeckoId: "pepe", keywords: ["pepe", "meme"] },
  bonk: { coingeckoId: "bonk", keywords: ["bonk", "meme"] },
  usdc: { coingeckoId: "usd-coin", keywords: ["usdc", "circle", "stablecoin"] },
  usdt: { coingeckoId: "tether", keywords: ["usdt", "tether", "stablecoin"] },
  aave: { coingeckoId: "aave", keywords: ["aave", "defi", "lending"] },
};

/**
 * Reverse lookup: CoinGecko ID -> keywords for matching.
 */
export function getKeywordsForCoinId(coingeckoId: string): string[] {
  for (const entry of Object.values(CRYPTO_KEYWORD_MAP)) {
    if (entry.coingeckoId === coingeckoId) return entry.keywords;
  }
  return [];
}

/**
 * Deduplicate a PredictionMarket array by id.
 */
export function deduplicateById(markets: PredictionMarket[]): PredictionMarket[] {
  const seen = new Set<string>();
  return markets.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

/**
 * Extract price targets from prediction market questions.
 * Matches patterns like "$100K", "$200", "$1M", "$50,000", etc.
 */
export function extractPriceTarget(question: string): number | null {
  // Match $X, $XK, $XM, $X,XXX patterns
  const match = question.match(
    /\$\s*([\d,]+(?:\.\d+)?)\s*(k|m|b|thousand|million|billion)?/i
  );
  if (!match) return null;

  const base = parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;

  const suffix = (match[2] ?? "").toLowerCase();
  switch (suffix) {
    case "k":
    case "thousand":
      return base * 1_000;
    case "m":
    case "million":
      return base * 1_000_000;
    case "b":
    case "billion":
      return base * 1_000_000_000;
    default:
      return base;
  }
}

/**
 * Check if a market question matches any keywords (case-insensitive).
 */
export function questionMatchesKeywords(
  question: string,
  keywords: string[]
): boolean {
  const lower = question.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * Flatten all diverse market arrays into a single deduped list.
 */
export function flattenDiverseMarkets(diverse: {
  topByVolume: PredictionMarket[];
  recentlyAdded: PredictionMarket[];
  matched: PredictionMarket[];
  highConfidence: PredictionMarket[];
  closeCall: PredictionMarket[];
}): PredictionMarket[] {
  return deduplicateById([
    ...diverse.topByVolume,
    ...diverse.matched,
    ...diverse.highConfidence,
    ...diverse.closeCall,
    ...diverse.recentlyAdded,
  ]);
}
