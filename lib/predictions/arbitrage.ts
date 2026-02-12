import type { PredictionMarket, ArbitrageOpportunity, PredictionPlatform } from "./types";

// Topics where AI/data analysis has a measurable edge (quantifiable outcomes)
const AI_EDGE_KEYWORDS: string[] = [
  // Crypto price targets — data-rich, chart-analyzable
  "bitcoin", "btc", "ethereum", "eth", "solana", "sol", "crypto", "price",
  "market cap", "token", "memecoin", "meme coin",
  // Quantitative / statistics-heavy
  "gdp", "inflation", "cpi", "unemployment", "rate cut", "interest rate",
  "fed", "federal reserve",
  // Sports (model-able with stats)
  "nba", "nfl", "mlb", "premier league", "champions league", "world cup",
  "super bowl", "mvp", "winner", "championship",
  // AI/tech (domain expertise)
  "ai", "artificial intelligence", "gpt", "openai", "google", "apple",
  "earnings", "revenue", "stock",
  // Elections / polls (poll-aggregation edge)
  "election", "president", "senate", "governor", "polling", "vote",
];

/**
 * Score how well-suited a market question is for AI/data-driven analysis.
 * Returns 0-1 where higher = more data-driven edge.
 */
function computeAiEdge(question: string): number {
  const q = question.toLowerCase();
  let hits = 0;
  for (const kw of AI_EDGE_KEYWORDS) {
    if (q.includes(kw)) hits++;
  }
  // Normalize: 1 keyword = 0.3, 2 = 0.5, 3+ = 0.7+, cap at 1.0
  if (hits === 0) return 0;
  return Math.min(0.3 + (hits - 1) * 0.2, 1.0);
}

/**
 * Compute urgency score based on time to resolution.
 * Markets resolving in <7 days are most urgent/actionable.
 */
function computeUrgency(markets: PredictionMarket[]): number {
  const now = Date.now();
  let minDays = Infinity;
  for (const m of markets) {
    if (m.endDate) {
      const days = (new Date(m.endDate).getTime() - now) / (1000 * 60 * 60 * 24);
      if (days > 0 && days < minDays) minDays = days;
    }
  }
  if (!Number.isFinite(minDays)) return 0.1; // no end date = low urgency
  if (minDays <= 1) return 1.0;
  if (minDays <= 7) return 0.8;
  if (minDays <= 30) return 0.5;
  if (minDays <= 90) return 0.3;
  return 0.1;
}

function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aWords = new Set(a.split(" "));
  const bWords = new Set(b.split(" "));
  const intersectionSize = [...aWords].filter((w) => bWords.has(w)).length;
  const unionSize = new Set([...aWords, ...bWords]).size || 1;
  return intersectionSize / unionSize;
}

function groupByQuestion(markets: PredictionMarket[]): Map<string, PredictionMarket[]> {
  const map = new Map<string, PredictionMarket[]>();
  for (const m of markets) {
    const key = normalizeQuestion(m.question);
    const arr = map.get(key);
    if (arr) arr.push(m);
    else map.set(key, [m]);
  }
  return map;
}

type PlatformBuckets = Record<PredictionPlatform, PredictionMarket[]>;

function bucketByPlatform(markets: PredictionMarket[]): PlatformBuckets {
  return markets.reduce(
    (acc, m) => {
      acc[m.platform].push(m);
      return acc;
    },
    { polymarket: [] as PredictionMarket[], manifold: [] as PredictionMarket[] }
  );
}

function computeArbForPair(a: PredictionMarket, b: PredictionMarket): ArbitrageOpportunity | null {
  // Classic cross-book arbitrage: buy YES on cheaper venue and NO on cheaper venue if sum < 1
  const yesBuy = a.yesPrice < b.yesPrice ? a : b;
  const noBuy = a.noPrice < b.noPrice ? a : b;
  const sum = yesBuy.yesPrice + noBuy.noPrice;
  const impliedProfit = sum < 1 ? 1 - sum : undefined;

  const yesSpread = a.yesPrice - b.yesPrice;
  const noSpread = a.noPrice - b.noPrice;

  if (!impliedProfit && Math.abs(yesSpread) < 0.01 && Math.abs(noSpread) < 0.01) return null;

  const question = a.question.length <= b.question.length ? a.question : b.question;
  const markets = [a, b];

  return {
    question,
    markets,
    yesSpread,
    noSpread,
    bestYesBuy: { market: yesBuy, side: "YES", price: yesBuy.yesPrice },
    bestNoBuy: { market: noBuy, side: "NO", price: noBuy.noPrice },
    impliedProfit,
    aiEdgeScore: computeAiEdge(question),
    urgency: computeUrgency(markets),
  };
}

export function findArbitrageOpportunities(
  polymarkets: PredictionMarket[],
  manifoldMarkets: PredictionMarket[],
  options: { minSimilarity?: number; minSpread?: number }
): ArbitrageOpportunity[] {
  const { minSimilarity = 0.75, minSpread = 0.01 } = options;

  const polyByKey = groupByQuestion(polymarkets);
  const maniList = manifoldMarkets.map((m) => ({
    market: m,
    norm: normalizeQuestion(m.question),
  }));

  const opportunities: ArbitrageOpportunity[] = [];

  for (const [key, polyGroup] of polyByKey.entries()) {
    for (const poly of polyGroup) {
      for (const { market: mani, norm } of maniList) {
        const sim = similarity(key, norm);
        if (sim < minSimilarity) continue;
        const opp = computeArbForPair(poly, mani);
        if (!opp) continue;
        const maxAbsSpread = Math.max(Math.abs(opp.yesSpread ?? 0), Math.abs(opp.noSpread ?? 0));
        if (maxAbsSpread < minSpread && (opp.impliedProfit ?? 0) < minSpread) continue;
        opportunities.push(opp);
      }
    }
  }

  // Composite sort: profit (50%) + AI-edge (30%) + urgency (20%)
  opportunities.sort((a, b) => {
    const scoreA =
      (a.impliedProfit ?? 0) * 50 +
      (a.aiEdgeScore ?? 0) * 30 +
      (a.urgency ?? 0) * 20;
    const scoreB =
      (b.impliedProfit ?? 0) * 50 +
      (b.aiEdgeScore ?? 0) * 30 +
      (b.urgency ?? 0) * 20;
    return scoreB - scoreA;
  });

  return opportunities;
}

