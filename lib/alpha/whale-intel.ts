import type { WalletAnalyticsPayload } from "@/lib/helius/analytics";
import type { PredictionMarket } from "@/lib/predictions/types";
import { CRYPTO_KEYWORD_MAP, questionMatchesKeywords } from "./shared";

// ── Types ────────────────────────────────────────────────────────

export type StrategyType =
  | "defi_trader"
  | "nft_flipper"
  | "whale_accumulator"
  | "staker"
  | "day_trader"
  | "long_term_holder";

export type WalletStrategy = {
  type: StrategyType;
  confidence: number; // 0-1
  signals: string[];
};

export type ActivityPattern = {
  avgTxPerDay: number;
  classification: "daily" | "weekly" | "monthly" | "dormant";
  recentActivity: string;
};

export type ConcentrationMetrics = {
  topHoldingPct: number;
  top3Pct: number;
  herfindahlIndex: number;
  uniqueTokens: number;
  diversificationRating: "concentrated" | "moderate" | "diversified";
};

export type PredictionCrossRef = {
  tokenSymbol: string;
  holdingAmount: number;
  relatedMarkets: {
    question: string;
    yesPrice: number;
    relevance: string;
  }[];
};

export type WhaleProfile = {
  strategies: WalletStrategy[];
  primaryStrategy: WalletStrategy;
  concentration: ConcentrationMetrics;
  activity: ActivityPattern;
  predictionCrossRefs: PredictionCrossRef[];
  riskRating: "low" | "medium" | "high";
  summary: string;
};

// ── Core Functions ───────────────────────────────────────────────

/**
 * Classify wallet strategy from transaction patterns, token diversity, and labels.
 */
export function classifyStrategy(
  transactions: WalletAnalyticsPayload["transactions"],
  tokenCount: number,
  nftCount: number,
  labels: string[]
): WalletStrategy[] {
  const strategies: WalletStrategy[] = [];
  const txCount = transactions.length;
  const lowerLabels = labels.map((l) => l.toLowerCase());

  // Count transaction types
  const typeCounts: Record<string, number> = {};
  for (const tx of transactions) {
    const type = (tx.type ?? "UNKNOWN").toUpperCase();
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
  }

  const swapCount = (typeCounts["SWAP"] ?? 0) + (typeCounts["TOKEN_SWAP"] ?? 0);
  const transferCount = typeCounts["TRANSFER"] ?? 0;
  const nftTxCount =
    (typeCounts["NFT_SALE"] ?? 0) +
    (typeCounts["NFT_MINT"] ?? 0) +
    (typeCounts["NFT_LISTING"] ?? 0) +
    (typeCounts["NFT_BID"] ?? 0);
  const stakeCount =
    (typeCounts["STAKE"] ?? 0) + (typeCounts["STAKE_SOL"] ?? 0);

  // DeFi trader
  if (swapCount > txCount * 0.3 || lowerLabels.some((l) => l.includes("defi"))) {
    strategies.push({
      type: "defi_trader",
      confidence: Math.min(swapCount / Math.max(txCount, 1), 1),
      signals: [
        `${swapCount} swap transactions (${((swapCount / Math.max(txCount, 1)) * 100).toFixed(0)}% of activity)`,
        ...(lowerLabels.some((l) => l.includes("defi")) ? ["DeFi label detected"] : []),
      ],
    });
  }

  // NFT flipper
  if (nftTxCount > 3 || nftCount > 10 || lowerLabels.some((l) => l.includes("nft"))) {
    strategies.push({
      type: "nft_flipper",
      confidence: Math.min((nftTxCount + nftCount * 0.1) / 20, 1),
      signals: [
        `${nftCount} NFTs held`,
        `${nftTxCount} NFT-related transactions`,
        ...(lowerLabels.some((l) => l.includes("nft")) ? ["NFT label detected"] : []),
      ],
    });
  }

  // Whale accumulator
  if (
    lowerLabels.some((l) => l.includes("whale")) ||
    tokenCount > 50 ||
    transferCount > txCount * 0.4
  ) {
    strategies.push({
      type: "whale_accumulator",
      confidence: lowerLabels.some((l) => l.includes("whale"))
        ? 0.9
        : Math.min(tokenCount / 100, 0.8),
      signals: [
        ...(lowerLabels.some((l) => l.includes("whale")) ? ["Whale label detected"] : []),
        `${tokenCount} unique tokens held`,
        `${transferCount} transfer transactions`,
      ],
    });
  }

  // Staker
  if (stakeCount > 0 || lowerLabels.some((l) => l.includes("staker"))) {
    strategies.push({
      type: "staker",
      confidence: Math.min(stakeCount / 5, 0.9),
      signals: [
        `${stakeCount} staking transactions`,
        ...(lowerLabels.some((l) => l.includes("staker")) ? ["Staker label detected"] : []),
      ],
    });
  }

  // Day trader (high frequency)
  if (txCount > 0) {
    const timespan = getTransactionTimespan(transactions);
    const txPerDay = timespan > 0 ? txCount / timespan : txCount;
    if (txPerDay > 5 || lowerLabels.some((l) => l.includes("bot") || l.includes("mev"))) {
      strategies.push({
        type: "day_trader",
        confidence: Math.min(txPerDay / 20, 1),
        signals: [
          `~${txPerDay.toFixed(1)} transactions per day`,
          ...(lowerLabels.some((l) => l.includes("bot")) ? ["Bot label detected"] : []),
        ],
      });
    }
  }

  // Long-term holder (low activity, some holdings)
  if (txCount < 20 && tokenCount > 0) {
    strategies.push({
      type: "long_term_holder",
      confidence: Math.min(1 - txCount / 20, 0.8),
      signals: [
        `Only ${txCount} recent transactions`,
        `Holding ${tokenCount} tokens with minimal activity`,
      ],
    });
  }

  // Default if nothing matched
  if (strategies.length === 0) {
    strategies.push({
      type: "long_term_holder",
      confidence: 0.3,
      signals: ["Insufficient data for confident classification"],
    });
  }

  return strategies.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Compute portfolio concentration metrics.
 */
export function computeConcentration(
  tokenAccounts: WalletAnalyticsPayload["tokenAccounts"],
  solBalance: number
): ConcentrationMetrics {
  // Normalize balances by decimals
  const balances = tokenAccounts
    .map((t) => {
      const dec = t.decimals ?? 0;
      return dec > 0 ? t.amount / Math.pow(10, dec) : t.amount;
    })
    .filter((b) => b > 0)
    .sort((a, b) => b - a);

  // Include SOL balance as a holding
  if (solBalance > 0) {
    balances.push(solBalance);
    balances.sort((a, b) => b - a);
  }

  const total = balances.reduce((s, b) => s + b, 0);
  if (total === 0 || balances.length === 0) {
    return {
      topHoldingPct: 0,
      top3Pct: 0,
      herfindahlIndex: 0,
      uniqueTokens: 0,
      diversificationRating: "concentrated",
    };
  }

  const topHoldingPct = (balances[0] / total) * 100;
  const top3 = balances.slice(0, 3).reduce((s, b) => s + b, 0);
  const top3Pct = (top3 / total) * 100;

  // Herfindahl-Hirschman Index (sum of squared market shares)
  const hhi = balances.reduce((s, b) => {
    const share = b / total;
    return s + share * share;
  }, 0);

  const uniqueTokens = balances.length;
  const diversificationRating: ConcentrationMetrics["diversificationRating"] =
    hhi > 0.5
      ? "concentrated"
      : hhi > 0.2
        ? "moderate"
        : "diversified";

  return {
    topHoldingPct,
    top3Pct,
    herfindahlIndex: hhi,
    uniqueTokens,
    diversificationRating,
  };
}

/**
 * Compute activity pattern from transaction history.
 */
export function computeActivityPattern(
  transactions: WalletAnalyticsPayload["transactions"],
  alliumEnrichment?: WalletAnalyticsPayload["alliumEnrichment"]
): ActivityPattern {
  const txCount = alliumEnrichment?.totalTxCount ?? transactions.length;
  const firstSeen = alliumEnrichment?.firstSeen;
  const lastActive = alliumEnrichment?.lastActive;

  let daySpan = getTransactionTimespan(transactions);
  if (firstSeen) {
    const first = new Date(firstSeen).getTime();
    const last = lastActive
      ? new Date(lastActive).getTime()
      : Date.now();
    daySpan = Math.max(daySpan, (last - first) / (1000 * 60 * 60 * 24));
  }

  const avgTxPerDay = daySpan > 0 ? txCount / daySpan : txCount;

  let classification: ActivityPattern["classification"];
  if (avgTxPerDay >= 1) classification = "daily";
  else if (avgTxPerDay >= 0.14) classification = "weekly"; // ~1/week
  else if (avgTxPerDay >= 0.03) classification = "monthly"; // ~1/month
  else classification = "dormant";

  const recentActivity = lastActive
    ? `Last active: ${new Date(lastActive).toLocaleDateString()}`
    : transactions.length > 0 && transactions[0].blockTime
      ? `Last tx: ${new Date(transactions[0].blockTime * 1000).toLocaleDateString()}`
      : "No recent activity data";

  return { avgTxPerDay, classification, recentActivity };
}

/**
 * Cross-reference token holdings with prediction markets.
 * "Holds SOL, and Polymarket says 70% chance of Solana ETF approval"
 */
export function crossRefWithPredictions(
  tokenAccounts: WalletAnalyticsPayload["tokenAccounts"],
  markets: PredictionMarket[]
): PredictionCrossRef[] {
  const crossRefs: PredictionCrossRef[] = [];

  // Get unique token symbols from holdings
  const heldSymbols = new Map<string, number>();
  for (const t of tokenAccounts) {
    if (t.symbol && t.amount > 0) {
      const sym = t.symbol.toLowerCase();
      const dec = t.decimals ?? 0;
      const balance = dec > 0 ? t.amount / Math.pow(10, dec) : t.amount;
      heldSymbols.set(sym, (heldSymbols.get(sym) ?? 0) + balance);
    }
  }

  for (const [sym, amount] of heldSymbols) {
    const entry = CRYPTO_KEYWORD_MAP[sym];
    if (!entry) continue;

    const relatedMarkets = markets
      .filter((m) => questionMatchesKeywords(m.question, entry.keywords))
      .map((m) => ({
        question: m.question,
        yesPrice: m.yesPrice,
        relevance: `Holds ${sym.toUpperCase()}, market says ${(m.yesPrice * 100).toFixed(0)}% YES`,
      }));

    if (relatedMarkets.length > 0) {
      crossRefs.push({
        tokenSymbol: sym.toUpperCase(),
        holdingAmount: amount,
        relatedMarkets: relatedMarkets.slice(0, 5),
      });
    }
  }

  return crossRefs;
}

/**
 * Build complete whale profile from wallet data + prediction markets.
 */
export function buildWhaleProfile(
  walletData: WalletAnalyticsPayload,
  markets: PredictionMarket[]
): WhaleProfile {
  const labels = walletData.alliumEnrichment?.labels ?? [];

  const strategies = classifyStrategy(
    walletData.transactions,
    walletData.tokenCount,
    walletData.nftCount,
    labels
  );

  const concentration = computeConcentration(
    walletData.tokenAccounts,
    walletData.solBalance
  );

  const activity = computeActivityPattern(
    walletData.transactions,
    walletData.alliumEnrichment
  );

  const predictionCrossRefs = crossRefWithPredictions(
    walletData.tokenAccounts,
    markets
  );

  // Risk rating
  const riskRating: WhaleProfile["riskRating"] =
    concentration.diversificationRating === "concentrated" &&
    activity.classification === "daily"
      ? "high"
      : concentration.diversificationRating === "diversified" ||
          activity.classification === "dormant"
        ? "low"
        : "medium";

  const primary = strategies[0];
  const summary = `${primary.type.replace(/_/g, " ")} (${(primary.confidence * 100).toFixed(0)}% confidence). ${concentration.diversificationRating} portfolio with ${concentration.uniqueTokens} tokens. ${activity.classification} activity pattern. ${riskRating} risk profile.`;

  return {
    strategies,
    primaryStrategy: primary,
    concentration,
    activity,
    predictionCrossRefs,
    riskRating,
    summary,
  };
}

/**
 * Serialize whale profile for LLM context injection.
 */
export function serializeWhaleForLLM(
  profile: WhaleProfile,
  walletData: WalletAnalyticsPayload,
  prompt: string
): string {
  const parts: string[] = [];
  const addr = walletData.address;
  const short = `${addr.slice(0, 4)}...${addr.slice(-4)}`;

  parts.push(`User asked: "${prompt}"`);
  parts.push(`\nWHALE INTELLIGENCE REPORT for ${short} (${addr})`);

  parts.push(`\nSUMMARY: ${profile.summary}`);

  parts.push(`\nSTRATEGY CLASSIFICATION:`);
  for (const s of profile.strategies) {
    parts.push(
      `  - ${s.type}: ${(s.confidence * 100).toFixed(0)}% confidence | Signals: ${s.signals.join("; ")}`
    );
  }

  parts.push(`\nPORTFOLIO CONCENTRATION:`);
  parts.push(`  Top holding: ${profile.concentration.topHoldingPct.toFixed(1)}%`);
  parts.push(`  Top 3 holdings: ${profile.concentration.top3Pct.toFixed(1)}%`);
  parts.push(`  HHI: ${profile.concentration.herfindahlIndex.toFixed(3)}`);
  parts.push(`  Unique tokens: ${profile.concentration.uniqueTokens}`);
  parts.push(`  Rating: ${profile.concentration.diversificationRating}`);

  parts.push(`\nACTIVITY PATTERN:`);
  parts.push(`  Avg tx/day: ${profile.activity.avgTxPerDay.toFixed(2)}`);
  parts.push(`  Classification: ${profile.activity.classification}`);
  parts.push(`  ${profile.activity.recentActivity}`);

  parts.push(`\nRISK RATING: ${profile.riskRating}`);

  parts.push(`\nWALLET DATA:`);
  parts.push(`  SOL Balance: ${walletData.solBalance.toFixed(4)} SOL`);
  parts.push(`  Tokens: ${walletData.tokenCount}`);
  parts.push(`  NFTs: ${walletData.nftCount}`);
  parts.push(`  Recent transactions: ${walletData.transactionCount}`);
  if (walletData.alliumEnrichment?.totalTxCount) {
    parts.push(`  Lifetime transactions: ${walletData.alliumEnrichment.totalTxCount}`);
  }
  if (walletData.alliumEnrichment?.labels?.length) {
    parts.push(`  Labels: ${walletData.alliumEnrichment.labels.join(", ")}`);
  }

  if (profile.predictionCrossRefs.length > 0) {
    parts.push(`\nPREDICTION MARKET CROSS-REFERENCES:`);
    for (const ref of profile.predictionCrossRefs) {
      parts.push(`  ${ref.tokenSymbol} (holding ${ref.holdingAmount.toLocaleString()}):`);
      for (const m of ref.relatedMarkets) {
        parts.push(`    - "${m.question}" | YES: ${(m.yesPrice * 100).toFixed(1)}% | ${m.relevance}`);
      }
    }
  }

  return parts.join("\n");
}

// ── Helpers ──────────────────────────────────────────────────────

function getTransactionTimespan(
  transactions: WalletAnalyticsPayload["transactions"]
): number {
  const times = transactions
    .map((t) => t.blockTime)
    .filter((t): t is number => t != null);
  if (times.length < 2) return 1;
  const min = Math.min(...times);
  const max = Math.max(...times);
  return Math.max((max - min) / (60 * 60 * 24), 1);
}
