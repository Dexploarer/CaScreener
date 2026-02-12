export type PredictionPlatform = "polymarket" | "manifold";

/** Unified market shape used across platforms. All prices are 0-1 YES probabilities. */
export type PredictionMarket = {
  id: string;
  platform: PredictionPlatform;
  question: string;
  /** YES price in [0,1] */
  yesPrice: number;
  /** NO price in [0,1]; can be derived as 1 - yesPrice for binary markets. */
  noPrice: number;
  /** Total traded volume (platform-native units) */
  volume?: number;
  /** 24h volume if available */
  volume24h?: number;
  /** Liquidity / open interest if available */
  liquidity?: number;
  category?: string;
  /** ISO string close / end date when available */
  endDate?: string;
  url?: string;
  isResolved?: boolean;
  /** Optional bid/ask spread or implied edge (0-1) when available */
  spread?: number;
};

export type ArbitrageLeg = {
  market: PredictionMarket;
  side: "YES" | "NO";
  price: number;
};

export type ArbitrageOpportunity = {
  question: string;
  /** All matched markets for this question across platforms */
  markets: PredictionMarket[];
  /** Buy YES here, hedge elsewhere; positive means polymarket YES > manifold YES, etc. */
  yesSpread?: number;
  /** Buy NO here, hedge elsewhere. */
  noSpread?: number;
  /** Best leg to buy YES (lowest price) */
  bestYesBuy?: ArbitrageLeg;
  /** Best leg to buy NO (lowest price) */
  bestNoBuy?: ArbitrageLeg;
  /**
   * Theoretical risk-free profit percentage if both legs can be executed
   * (e.g. 0.03 == 3% ROI).
   */
  impliedProfit?: number;
  /**
   * AI-edge score 0-1: how well-suited this opportunity is for data-driven analysis.
   * High when markets involve quantifiable, data-rich topics (crypto prices, sports stats, etc.).
   */
  aiEdgeScore?: number;
  /**
   * Urgency 0-1: how soon the market resolves. Higher = resolving sooner = more actionable.
   */
  urgency?: number;
};

/** Clamp a numeric value into [min,max]. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Normalize a YES price into [0,1] and derive NO. */
export function toYesNoPrices(rawYes: number): { yesPrice: number; noPrice: number } {
  const yes = clamp(rawYes, 0, 1);
  const no = clamp(1 - yes, 0, 1);
  return { yesPrice: yes, noPrice: no };
}

