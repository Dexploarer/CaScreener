import type { PredictionMarket, ArbitrageOpportunity, PredictionPlatform } from "./types";

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

  return {
    question: a.question.length <= b.question.length ? a.question : b.question,
    markets: [a, b],
    yesSpread,
    noSpread,
    bestYesBuy: { market: yesBuy, side: "YES", price: yesBuy.yesPrice },
    bestNoBuy: { market: noBuy, side: "NO", price: noBuy.noPrice },
    impliedProfit,
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

  // Sort highest theoretical profit first
  opportunities.sort(
    (a, b) => (b.impliedProfit ?? 0) - (a.impliedProfit ?? 0)
  );

  return opportunities;
}

