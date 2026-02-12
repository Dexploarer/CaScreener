import type { PredictionMarket } from "@/lib/predictions/types";
import type { CoinMarketData } from "@/lib/market-data/coingecko";

// ── Dynamic Keyword Map ─────────────────────────────────────────

export type DynamicKeywordEntry = {
  coingeckoId: string;
  symbol: string;
  name: string;
  keywords: string[];
};

/**
 * Build a keyword map dynamically from actual market data.
 * No hardcoded tickers — every token in the dataset gets keywords
 * derived from its real CoinGecko id, symbol, and name.
 */
export function buildKeywordMap(
  coins: CoinMarketData[]
): Map<string, DynamicKeywordEntry> {
  const map = new Map<string, DynamicKeywordEntry>();

  for (const coin of coins) {
    const sym = coin.symbol.toLowerCase();
    const nameLower = coin.name.toLowerCase();
    const keywords: string[] = [coin.id, sym, nameLower];

    // Add individual words from multi-word names (e.g., "shiba inu" → "shiba", "inu")
    if (nameLower.includes(" ")) {
      for (const word of nameLower.split(/\s+/)) {
        if (word.length > 2 && !keywords.includes(word)) {
          keywords.push(word);
        }
      }
    }

    // Avoid clobbering a higher-cap coin with the same symbol
    const existing = map.get(sym);
    if (existing) {
      const existingCoin = coins.find((c) => c.id === existing.coingeckoId);
      if (existingCoin && existingCoin.market_cap > coin.market_cap) continue;
    }

    map.set(sym, {
      coingeckoId: coin.id,
      symbol: sym,
      name: coin.name,
      keywords,
    });
  }

  return map;
}

/**
 * Generate match keywords directly from a single coin.
 * Used by linkMarketsToCrypto to match prediction market questions.
 */
export function getKeywordsForCoin(coin: CoinMarketData): string[] {
  const nameLower = coin.name.toLowerCase();
  const keywords = [coin.id, coin.symbol.toLowerCase(), nameLower];

  if (nameLower.includes(" ")) {
    for (const word of nameLower.split(/\s+/)) {
      if (word.length > 2 && !keywords.includes(word)) {
        keywords.push(word);
      }
    }
  }

  return keywords;
}

// ── Utilities ────────────────────────────────────────────────────

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
  aiEdge?: PredictionMarket[];
}): PredictionMarket[] {
  return deduplicateById([
    ...diverse.topByVolume,
    ...diverse.matched,
    ...diverse.highConfidence,
    ...diverse.closeCall,
    ...(diverse.aiEdge ?? []),
    ...diverse.recentlyAdded,
  ]);
}
