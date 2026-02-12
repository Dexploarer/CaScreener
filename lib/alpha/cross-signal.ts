import type { PredictionMarket } from "@/lib/predictions/types";
import type { CoinMarketData, GlobalData } from "@/lib/market-data/coingecko";
import {
  CRYPTO_KEYWORD_MAP,
  getKeywordsForCoinId,
  questionMatchesKeywords,
  extractPriceTarget,
} from "./shared";

// ── Types ────────────────────────────────────────────────────────

export type PriceDivergence = {
  market: PredictionMarket;
  coin: CoinMarketData;
  marketProbability: number;
  priceImpliedProbability: number;
  divergence: number; // absolute gap
  direction: "market_bullish" | "market_bearish" | "aligned";
  priceTarget: number | null;
  signal: string;
};

export type VolumeAnomaly = {
  market: PredictionMarket;
  volumeToAgeRatio: number;
  anomalyScore: number; // how many X above normal
  signal: string;
};

export type ConfidenceCluster = {
  topic: string;
  markets: PredictionMarket[];
  avgConfidence: number;
  direction: "bullish" | "bearish" | "mixed";
  signal: string;
};

export type LiquidityImbalance = {
  market: PredictionMarket;
  confidence: number;
  liquidity: number;
  ratio: number; // confidence / liquidity-normalized
  signal: string;
};

export type AlphaReport = {
  divergences: PriceDivergence[];
  volumeAnomalies: VolumeAnomaly[];
  confidenceClusters: ConfidenceCluster[];
  liquidityImbalances: LiquidityImbalance[];
  totalMarketsAnalyzed: number;
  totalCoinsAnalyzed: number;
  timestamp: string;
};

// ── Core Functions ───────────────────────────────────────────────

/**
 * Link prediction markets to crypto tokens via keyword matching.
 * Returns markets paired with their most relevant coin.
 */
export function linkMarketsToCrypto(
  markets: PredictionMarket[],
  coins: CoinMarketData[]
): { market: PredictionMarket; coin: CoinMarketData }[] {
  const linked: { market: PredictionMarket; coin: CoinMarketData }[] = [];

  for (const market of markets) {
    for (const coin of coins) {
      const keywords = getKeywordsForCoinId(coin.id);
      if (keywords.length === 0) {
        // Fallback: match by coin name/symbol in question
        const q = market.question.toLowerCase();
        if (
          q.includes(coin.name.toLowerCase()) ||
          q.includes(coin.symbol.toLowerCase())
        ) {
          linked.push({ market, coin });
          break;
        }
      } else if (questionMatchesKeywords(market.question, keywords)) {
        linked.push({ market, coin });
        break;
      }
    }
  }

  return linked;
}

/**
 * Estimate price-implied probability using 7d sparkline slope + logistic mapping.
 * If the price trend supports the market target, probability should be higher.
 */
export function computePriceImpliedProbability(
  coin: CoinMarketData,
  targetPrice: number | null,
  daysRemaining: number
): number {
  if (!targetPrice || targetPrice <= 0) return 0.5;

  const currentPrice = coin.current_price;
  if (currentPrice <= 0) return 0.5;

  // Compute 7d momentum from sparkline
  const sparkline = coin.sparkline_in_7d?.price;
  let momentum = 0;
  if (sparkline && sparkline.length >= 2) {
    const start = sparkline[0];
    const end = sparkline[sparkline.length - 1];
    if (start > 0) momentum = (end - start) / start; // fractional change over 7d
  }

  // Distance to target as fraction of current price
  const distanceRatio = (targetPrice - currentPrice) / currentPrice;

  // Time factor: more time = higher probability of reaching target
  const timeFactor = Math.min(daysRemaining / 365, 1);

  // Logistic mapping: combine momentum direction and distance
  const z = -distanceRatio * 3 + momentum * 10 + timeFactor * 0.5;
  const probability = 1 / (1 + Math.exp(-z));

  return Math.max(0.01, Math.min(0.99, probability));
}

/**
 * Detect markets where 24h volume is anomalously high relative to total volume.
 * Flags markets with volume spikes (potential signal of new information).
 */
export function detectVolumeAnomalies(
  markets: PredictionMarket[]
): VolumeAnomaly[] {
  const anomalies: VolumeAnomaly[] = [];

  // Compute baseline: median ratio of volume24h / volume
  const ratios = markets
    .filter((m) => (m.volume24h ?? 0) > 0 && (m.volume ?? 0) > 0)
    .map((m) => (m.volume24h ?? 0) / (m.volume ?? 1));

  if (ratios.length === 0) return [];

  ratios.sort((a, b) => a - b);
  const medianRatio = ratios[Math.floor(ratios.length / 2)];
  const threshold = Math.max(medianRatio * 3, 0.05); // 3x median or 5% minimum

  for (const m of markets) {
    const vol24 = m.volume24h ?? 0;
    const volTotal = m.volume ?? 0;
    if (vol24 <= 0 || volTotal <= 0) continue;

    const ratio = vol24 / volTotal;
    if (ratio > threshold) {
      const anomalyScore = ratio / medianRatio;
      anomalies.push({
        market: m,
        volumeToAgeRatio: ratio,
        anomalyScore,
        signal: `24h volume is ${anomalyScore.toFixed(1)}x the median ratio — unusual activity spike`,
      });
    }
  }

  return anomalies.sort((a, b) => b.anomalyScore - a.anomalyScore).slice(0, 10);
}

/**
 * Group markets by topic and detect when multiple markets in the same
 * category all trend the same direction (reinforcing signal).
 */
export function detectConfidenceClusters(
  markets: PredictionMarket[]
): ConfidenceCluster[] {
  // Group by category
  const groups = new Map<string, PredictionMarket[]>();
  for (const m of markets) {
    const cat = m.category ?? "uncategorized";
    const existing = groups.get(cat) ?? [];
    existing.push(m);
    groups.set(cat, existing);
  }

  // Also group by crypto-specific keyword themes
  const cryptoThemes: Record<string, PredictionMarket[]> = {};
  for (const [symbol, entry] of Object.entries(CRYPTO_KEYWORD_MAP)) {
    const matching = markets.filter((m) =>
      questionMatchesKeywords(m.question, entry.keywords)
    );
    if (matching.length >= 2) {
      cryptoThemes[symbol] = matching;
    }
  }

  const clusters: ConfidenceCluster[] = [];

  // Process category groups
  for (const [topic, group] of groups.entries()) {
    if (group.length < 2) continue;

    const avgYes = group.reduce((s, m) => s + m.yesPrice, 0) / group.length;
    const bullishCount = group.filter((m) => m.yesPrice > 0.6).length;
    const bearishCount = group.filter((m) => m.yesPrice < 0.4).length;

    let direction: "bullish" | "bearish" | "mixed" = "mixed";
    if (bullishCount > group.length * 0.6) direction = "bullish";
    else if (bearishCount > group.length * 0.6) direction = "bearish";

    if (direction !== "mixed") {
      clusters.push({
        topic,
        markets: group,
        avgConfidence: avgYes,
        direction,
        signal: `${group.length} markets in "${topic}" cluster ${direction === "bullish" ? "above" : "below"} 50% — ${direction} consensus`,
      });
    }
  }

  // Process crypto-specific clusters
  for (const [symbol, group] of Object.entries(cryptoThemes)) {
    const avgYes = group.reduce((s, m) => s + m.yesPrice, 0) / group.length;
    const bullishCount = group.filter((m) => m.yesPrice > 0.6).length;
    const bearishCount = group.filter((m) => m.yesPrice < 0.4).length;

    let direction: "bullish" | "bearish" | "mixed" = "mixed";
    if (bullishCount > group.length * 0.6) direction = "bullish";
    else if (bearishCount > group.length * 0.6) direction = "bearish";

    clusters.push({
      topic: `${symbol.toUpperCase()} crypto`,
      markets: group,
      avgConfidence: avgYes,
      direction,
      signal: `${group.length} ${symbol.toUpperCase()}-related markets trending ${direction} (avg YES: ${(avgYes * 100).toFixed(1)}%)`,
    });
  }

  return clusters.sort((a, b) => b.markets.length - a.markets.length).slice(0, 8);
}

/**
 * Find markets with high confidence but low liquidity —
 * potential opportunity where the market may be mispriced due to thin order books.
 */
export function detectLiquidityImbalances(
  markets: PredictionMarket[]
): LiquidityImbalance[] {
  const imbalances: LiquidityImbalance[] = [];

  // Only look at markets with liquidity data
  const withLiquidity = markets.filter((m) => (m.liquidity ?? 0) > 0);
  if (withLiquidity.length === 0) return [];

  // Median liquidity as baseline
  const liquidities = withLiquidity
    .map((m) => m.liquidity ?? 0)
    .sort((a, b) => a - b);
  const medianLiq = liquidities[Math.floor(liquidities.length / 2)];

  for (const m of withLiquidity) {
    const confidence = Math.abs(m.yesPrice - 0.5) * 2; // 0 = close call, 1 = extreme
    const liq = m.liquidity ?? 0;
    const liqNormalized = medianLiq > 0 ? liq / medianLiq : 1;

    // High confidence + low liquidity = opportunity
    if (confidence > 0.5 && liqNormalized < 0.5) {
      const ratio = confidence / Math.max(liqNormalized, 0.01);
      imbalances.push({
        market: m,
        confidence,
        liquidity: liq,
        ratio,
        signal: `${(m.yesPrice * 100).toFixed(0)}% confidence but only ${((liqNormalized) * 100).toFixed(0)}% of median liquidity — thin market, potential edge`,
      });
    }
  }

  return imbalances.sort((a, b) => b.ratio - a.ratio).slice(0, 10);
}

/**
 * Master function: run all detectors and return unified alpha report.
 */
export function generateAlphaReport(
  markets: PredictionMarket[],
  coins: CoinMarketData[],
  globalData: GlobalData | null
): AlphaReport {
  // Cross-reference markets with crypto
  const linked = linkMarketsToCrypto(markets, coins);

  // Compute divergences
  const divergences: PriceDivergence[] = [];
  for (const { market, coin } of linked) {
    const priceTarget = extractPriceTarget(market.question);
    const daysRemaining = market.endDate
      ? Math.max(
          1,
          (new Date(market.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        )
      : 180;

    const priceImplied = computePriceImpliedProbability(
      coin,
      priceTarget,
      daysRemaining
    );
    const marketProb = market.yesPrice;
    const gap = Math.abs(marketProb - priceImplied);

    if (gap > 0.15) {
      // At least 15% divergence
      const direction: PriceDivergence["direction"] =
        marketProb > priceImplied + 0.1
          ? "market_bullish"
          : marketProb < priceImplied - 0.1
            ? "market_bearish"
            : "aligned";

      divergences.push({
        market,
        coin,
        marketProbability: marketProb,
        priceImpliedProbability: priceImplied,
        divergence: gap,
        direction,
        priceTarget,
        signal:
          direction === "market_bullish"
            ? `Market says ${(marketProb * 100).toFixed(0)}% YES but price trend suggests ${(priceImplied * 100).toFixed(0)}% — market more optimistic than price action`
            : direction === "market_bearish"
              ? `Market says ${(marketProb * 100).toFixed(0)}% YES but price trend suggests ${(priceImplied * 100).toFixed(0)}% — market more pessimistic than price action`
              : `Aligned at ~${(marketProb * 100).toFixed(0)}%`,
      });
    }
  }

  return {
    divergences: divergences.sort((a, b) => b.divergence - a.divergence).slice(0, 10),
    volumeAnomalies: detectVolumeAnomalies(markets),
    confidenceClusters: detectConfidenceClusters(markets),
    liquidityImbalances: detectLiquidityImbalances(markets),
    totalMarketsAnalyzed: markets.length,
    totalCoinsAnalyzed: coins.length,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Serialize alpha report as text for LLM context injection.
 */
export function serializeAlphaForLLM(
  report: AlphaReport,
  prompt: string
): string {
  const parts: string[] = [];
  parts.push(`User asked: "${prompt}"`);
  parts.push(`\nALPHA REPORT (${report.totalMarketsAnalyzed} markets x ${report.totalCoinsAnalyzed} coins analyzed)`);

  if (report.divergences.length > 0) {
    parts.push(`\nPRICE-MARKET DIVERGENCES (${report.divergences.length}):`);
    for (const d of report.divergences) {
      parts.push(
        `  - ${d.coin.symbol.toUpperCase()}: "${d.market.question}" | Market: ${(d.marketProbability * 100).toFixed(1)}% | Price-Implied: ${(d.priceImpliedProbability * 100).toFixed(1)}% | Gap: ${(d.divergence * 100).toFixed(1)}% | ${d.direction} | ${d.signal}`
      );
    }
  }

  if (report.volumeAnomalies.length > 0) {
    parts.push(`\nVOLUME ANOMALIES (${report.volumeAnomalies.length}):`);
    for (const a of report.volumeAnomalies) {
      parts.push(
        `  - "${a.market.question}" | Score: ${a.anomalyScore.toFixed(1)}x | ${a.signal}`
      );
    }
  }

  if (report.confidenceClusters.length > 0) {
    parts.push(`\nCONFIDENCE CLUSTERS (${report.confidenceClusters.length}):`);
    for (const c of report.confidenceClusters) {
      parts.push(
        `  - ${c.topic}: ${c.markets.length} markets | Avg: ${(c.avgConfidence * 100).toFixed(1)}% | Direction: ${c.direction} | ${c.signal}`
      );
    }
  }

  if (report.liquidityImbalances.length > 0) {
    parts.push(`\nLIQUIDITY IMBALANCES (${report.liquidityImbalances.length}):`);
    for (const l of report.liquidityImbalances) {
      parts.push(
        `  - "${l.market.question}" | Confidence: ${(l.confidence * 100).toFixed(0)}% | Liquidity: $${l.liquidity.toLocaleString()} | ${l.signal}`
      );
    }
  }

  if (
    report.divergences.length === 0 &&
    report.volumeAnomalies.length === 0 &&
    report.confidenceClusters.length === 0 &&
    report.liquidityImbalances.length === 0
  ) {
    parts.push(
      `\nNo significant alpha signals detected in current data. Markets appear efficiently priced relative to crypto price trends.`
    );
  }

  return parts.join("\n");
}
