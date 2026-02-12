import type { TokenLookupResult } from "@/lib/helius/types";

/**
 * Multi-dimensional meme coin trust score.
 *
 * Philosophy: "Trust is earned, not assumed."
 * Tokens start at 0 and earn points across 5 dimensions.
 * This prevents unknown/new tokens from scoring high by default.
 *
 * Dimensions (total max = 100):
 *   Identity & Legitimacy  (max 20) — Is this the real token?
 *   Liquidity Depth         (max 25) — Can holders exit?
 *   Volume & Activity       (max 20) — Is trading organic?
 *   Trading Health           (max 15) — Buy/sell balance (PumpPortal)
 *   Market Maturity          (max 20) — How established is it?
 */

export type TrustReason = {
  key: string;
  label: string;
  impact: number;
  detail: string;
  link?: string;
};

export type TrustDimension = {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  reasons: TrustReason[];
};

export type TokenTrustScore = {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  reasons: TrustReason[];
  dimensions?: TrustDimension[];
  hardLinks: {
    mint: string;
    pair?: string;
    tx?: string;
    liquidity?: string;
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────

function clamp(value: number, max: number = 100): number {
  return Math.max(0, Math.min(max, Math.round(value)));
}

function gradeFromScore(score: number): TokenTrustScore["grade"] {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 45) return "C";
  if (score >= 30) return "D";
  return "F";
}

type CanonicalMatch =
  NonNullable<TokenLookupResult["sameTickerTokens"]>[number];

function pickCanonicalPair(
  token: TokenLookupResult
): CanonicalMatch | undefined {
  const matches = token.sameTickerTokens ?? [];
  return (
    matches.find((m) => m.isExactMintMatch) ??
    matches
      .slice()
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))[0]
  );
}

function fmt(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtUsd(value: number): string {
  return `$${fmt(value)}`;
}

function safePct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function mintExplorerLink(id: string): string {
  return `https://explorer.solana.com/address/${id}`;
}

/**
 * Determines if the canonical token is clearly the dominant one for its ticker.
 * A dominant token has the highest liquidity and is significantly ahead of the
 * next competitor (2x+). When dominant, copycat tokens should not penalize the
 * real token — being copied is a sign of popularity, not risk.
 */
function isDominantForTicker(
  canonical: CanonicalMatch | undefined,
  matches: NonNullable<TokenLookupResult["sameTickerTokens"]>
): boolean {
  if (!canonical) return false;
  const canonicalLiq = canonical.liquidityUsd ?? 0;
  if (canonicalLiq <= 0) return false;

  // Find the highest liquidity among non-canonical same-ticker tokens
  let secondBestLiq = 0;
  for (const m of matches) {
    if (m.mint.toLowerCase() === canonical.mint.toLowerCase()) continue;
    const liq = m.liquidityUsd ?? 0;
    if (liq > secondBestLiq) secondBestLiq = liq;
  }

  // Dominant if canonical has 2x the liquidity of the next competitor,
  // or if canonical has real liquidity (>$10K) and next best is micro (<$5K)
  return (
    canonicalLiq >= secondBestLiq * 2 ||
    (canonicalLiq >= 10_000 && secondBestLiq < 5_000)
  );
}

// ─── Dimension 1: Identity & Legitimacy (max 20) ─────────────────────

function scoreIdentity(
  token: TokenLookupResult,
  canonical: CanonicalMatch | undefined
): TrustDimension {
  const MAX = 20;
  let score = 0;
  const reasons: TrustReason[] = [];
  const matches = token.sameTickerTokens ?? [];
  const total = token.sameTickerCount ?? matches.length;
  const suspicious = token.suspiciousTickerCount ?? 0;
  const suspiciousRatio = total > 0 ? suspicious / total : 0;
  const mLink = mintExplorerLink(token.id);

  // Determine if this token is clearly the top dog for its ticker.
  // If so, copycats targeting it shouldn't hurt its score.
  const dominant = isDominantForTicker(canonical, matches);

  // Canonical pair found (+6)
  if (canonical) {
    score += 6;
    reasons.push({
      key: "canonical_found",
      label: "Canonical market pair verified",
      impact: 6,
      detail: "Primary trading pair verified on DexScreener.",
      link: canonical.url ?? mLink,
    });
  } else {
    reasons.push({
      key: "no_canonical_pair",
      label: "No canonical market pair",
      impact: 0,
      detail:
        "Could not verify a primary Solana market pair. Major red flag for legitimacy.",
      link: mLink,
    });
  }

  // Exact mint match (+6)
  if (canonical?.isExactMintMatch) {
    score += 6;
    reasons.push({
      key: "exact_mint_match",
      label: "Exact mint match confirmed",
      impact: 6,
      detail: "Canonical pair matches the exact mint address queried.",
      link: canonical.url ?? mLink,
    });
  } else if (canonical && token.lookupMode === "ticker") {
    reasons.push({
      key: "ticker_not_exact",
      label: "Ticker lookup — no exact mint match",
      impact: 0,
      detail:
        "Ticker search did not resolve to a clear exact-mint canonical result.",
      link: canonical.url ?? mLink,
    });
  }

  // Ticker crowding (+4)
  // Dominant tokens get full points even with copycats — being copied = popular
  if (total < 8) {
    score += 4;
    reasons.push({
      key: "uncrowded_ticker",
      label: "Uncrowded ticker namespace",
      impact: 4,
      detail: `Only ${total} token(s) share this ticker.`,
      link: canonical?.url ?? mLink,
    });
  } else if (dominant) {
    score += 4;
    reasons.push({
      key: "dominant_despite_crowded",
      label: `Dominant token (${total} copycats)`,
      impact: 4,
      detail: `${total} tokens share this ticker, but this token dominates by liquidity. Copycats indicate popularity.`,
      link: canonical?.url ?? mLink,
    });
  } else {
    reasons.push({
      key: "crowded_ticker",
      label: `Crowded ticker (${total} tokens)`,
      impact: 0,
      detail: `${total} listings share this ticker, increasing impersonation risk.`,
      link: canonical?.url ?? mLink,
    });
  }

  // Suspicious competitors (+4 / +2 / 0)
  // Dominant tokens aren't penalized for having copycats — the copycats are the problem, not this token
  if (suspicious === 0) {
    score += 4;
    reasons.push({
      key: "no_suspicious",
      label: "No suspicious competitors",
      impact: 4,
      detail: "No medium/high-risk tokens found sharing this ticker.",
      link: canonical?.url ?? mLink,
    });
  } else if (dominant) {
    score += 4;
    reasons.push({
      key: "dominant_with_copycats",
      label: `${suspicious} copycat(s) — not a risk to this token`,
      impact: 4,
      detail: `${suspicious} suspicious same-ticker tokens exist, but this is the dominant token by liquidity. Copycats target its buyers, not the other way around.`,
      link: canonical?.url ?? mLink,
    });
  } else if (suspiciousRatio < 0.4) {
    score += 2;
    reasons.push({
      key: "some_suspicious",
      label: `${suspicious} suspicious competitor(s)`,
      impact: 2,
      detail: `${suspicious}/${total} same-ticker tokens are medium/high risk (${safePct(suspiciousRatio)}).`,
      link: canonical?.url ?? mLink,
    });
  } else {
    reasons.push({
      key: "high_suspicious_ratio",
      label: `High clone ratio (${safePct(suspiciousRatio)})`,
      impact: 0,
      detail: `${suspicious}/${total} same-ticker listings are medium/high risk.`,
      link: canonical?.url ?? mLink,
    });
  }

  return {
    key: "identity",
    label: "Identity & Legitimacy",
    score: clamp(score, MAX),
    maxScore: MAX,
    reasons,
  };
}

// ─── Dimension 2: Liquidity Depth (max 25) ────────────────────────────

function scoreLiquidity(
  token: TokenLookupResult,
  canonical: CanonicalMatch | undefined
): TrustDimension {
  const MAX = 25;
  let score = 0;
  const reasons: TrustReason[] = [];
  const mLink = mintExplorerLink(token.id);
  const link = canonical?.url ?? mLink;

  const liq = canonical?.liquidityUsd ?? 0;

  // Tiered liquidity scoring
  if (liq >= 100_000) {
    score = 25;
    reasons.push({
      key: "liquidity_excellent",
      label: "Excellent liquidity",
      impact: 25,
      detail: `Primary pair liquidity: ${fmtUsd(liq)}. Strong exit ability.`,
      link,
    });
  } else if (liq >= 50_000) {
    score = 20;
    reasons.push({
      key: "liquidity_strong",
      label: "Strong liquidity",
      impact: 20,
      detail: `Primary pair liquidity: ${fmtUsd(liq)}.`,
      link,
    });
  } else if (liq >= 25_000) {
    score = 15;
    reasons.push({
      key: "liquidity_moderate",
      label: "Moderate liquidity",
      impact: 15,
      detail: `Primary pair liquidity: ${fmtUsd(liq)}.`,
      link,
    });
  } else if (liq >= 10_000) {
    score = 10;
    reasons.push({
      key: "liquidity_low",
      label: "Low liquidity",
      impact: 10,
      detail: `Primary pair liquidity: ${fmtUsd(liq)}. Difficult to exit large positions.`,
      link,
    });
  } else if (liq >= 5_000) {
    score = 5;
    reasons.push({
      key: "liquidity_very_low",
      label: "Very low liquidity",
      impact: 5,
      detail: `Primary pair liquidity: ${fmtUsd(liq)}. High slippage risk.`,
      link,
    });
  } else if (liq > 0) {
    score = 2;
    reasons.push({
      key: "liquidity_micro",
      label: "Micro liquidity",
      impact: 2,
      detail: `Primary pair liquidity: ${fmtUsd(liq)}. Extremely thin — likely cannot exit.`,
      link,
    });
  } else {
    reasons.push({
      key: "liquidity_none",
      label: "No measurable liquidity",
      impact: 0,
      detail: "No liquidity data found. Cannot assess exit ability.",
      link,
    });
  }

  // FDV/liquidity imbalance penalty
  const fdv = canonical?.fdvUsd ?? 0;
  if (fdv > 0 && liq > 0) {
    const ratio = fdv / liq;
    if (ratio > 500) {
      const reduction = Math.floor(score * 0.5);
      score -= reduction;
      reasons.push({
        key: "fdv_liq_extreme",
        label: "Extreme FDV/liquidity imbalance",
        impact: -reduction,
        detail: `FDV is ${fmt(Math.round(ratio))}x liquidity. Exit liquidity trap risk.`,
        link,
      });
    } else if (ratio > 250) {
      const reduction = Math.floor(score * 0.25);
      score -= reduction;
      reasons.push({
        key: "fdv_liq_high",
        label: "High FDV/liquidity ratio",
        impact: -reduction,
        detail: `FDV is ${fmt(Math.round(ratio))}x liquidity. Limited exit capacity.`,
        link,
      });
    }
  }

  return {
    key: "liquidity",
    label: "Liquidity Depth",
    score: clamp(score, MAX),
    maxScore: MAX,
    reasons,
  };
}

// ─── Dimension 3: Volume & Activity (max 20) ──────────────────────────

function scoreVolume(
  token: TokenLookupResult,
  canonical: CanonicalMatch | undefined
): TrustDimension {
  const MAX = 20;
  let score = 0;
  const reasons: TrustReason[] = [];
  const mLink = mintExplorerLink(token.id);
  const link = canonical?.url ?? mLink;

  const vol = canonical?.volume24hUsd ?? 0;
  const liq = canonical?.liquidityUsd ?? 0;

  // 24h volume tiers (max 14)
  if (vol >= 100_000) {
    score += 14;
    reasons.push({
      key: "volume_high",
      label: "High 24h volume",
      impact: 14,
      detail: `24h volume: ${fmtUsd(vol)}. Active trading.`,
      link,
    });
  } else if (vol >= 50_000) {
    score += 11;
    reasons.push({
      key: "volume_good",
      label: "Good 24h volume",
      impact: 11,
      detail: `24h volume: ${fmtUsd(vol)}.`,
      link,
    });
  } else if (vol >= 25_000) {
    score += 8;
    reasons.push({
      key: "volume_moderate",
      label: "Moderate 24h volume",
      impact: 8,
      detail: `24h volume: ${fmtUsd(vol)}.`,
      link,
    });
  } else if (vol >= 10_000) {
    score += 5;
    reasons.push({
      key: "volume_low",
      label: "Low 24h volume",
      impact: 5,
      detail: `24h volume: ${fmtUsd(vol)}.`,
      link,
    });
  } else if (vol >= 1_000) {
    score += 2;
    reasons.push({
      key: "volume_very_low",
      label: "Very low 24h volume",
      impact: 2,
      detail: `24h volume: ${fmtUsd(vol)}. Thin activity.`,
      link,
    });
  } else {
    reasons.push({
      key: "volume_dead",
      label: "Negligible 24h volume",
      impact: 0,
      detail:
        vol > 0
          ? `24h volume: ${fmtUsd(vol)}. Essentially no activity.`
          : "No volume data found.",
      link,
    });
  }

  // Volume/Liquidity ratio health (max 6)
  if (liq > 0 && vol > 0) {
    const ratio = vol / liq;
    if (ratio >= 0.1 && ratio <= 5.0) {
      score += 6;
      reasons.push({
        key: "vol_liq_healthy",
        label: "Healthy volume/liquidity ratio",
        impact: 6,
        detail: `Vol/liq ratio: ${ratio.toFixed(2)}x. Indicates organic trading.`,
        link,
      });
    } else if (ratio > 5.0 && ratio <= 10.0) {
      score += 3;
      reasons.push({
        key: "vol_liq_elevated",
        label: "Elevated volume/liquidity ratio",
        impact: 3,
        detail: `Vol/liq ratio: ${ratio.toFixed(2)}x. Unusually high activity vs pool depth.`,
        link,
      });
    } else if (ratio > 10.0) {
      score += 1;
      reasons.push({
        key: "vol_liq_suspect",
        label: "Suspicious volume/liquidity ratio",
        impact: 1,
        detail: `Vol/liq ratio: ${ratio.toFixed(1)}x. Possible wash trading or extreme hype cycle.`,
        link,
      });
    } else {
      score += 2;
      reasons.push({
        key: "vol_liq_low",
        label: "Low volume relative to liquidity",
        impact: 2,
        detail: `Vol/liq ratio: ${ratio.toFixed(3)}x. Low engagement.`,
        link,
      });
    }
  }

  return {
    key: "volume",
    label: "Volume & Activity",
    score: clamp(score, MAX),
    maxScore: MAX,
    reasons,
  };
}

// ─── Dimension 4: Trading Health (max 15) ─────────────────────────────

function scoreTradingHealth(token: TokenLookupResult): TrustDimension {
  const MAX = 15;
  let score = 0;
  const reasons: TrustReason[] = [];
  const pump = token.pumpPortal;
  const mLink = mintExplorerLink(token.id);

  if (!pump || pump.recentTradeCount === 0) {
    reasons.push({
      key: "no_pump_data",
      label: "No recent trade data",
      impact: 0,
      detail:
        "No PumpPortal trade data available. Cannot assess trading patterns.",
      link: mLink,
    });
    return {
      key: "trading",
      label: "Trading Health",
      score: 0,
      maxScore: MAX,
      reasons,
    };
  }

  const totalTrades = pump.recentTradeCount;
  const buys = pump.buyCount;
  const sells = pump.sellCount;
  const totalBuySell = buys + sells;

  // Buy/sell balance (max 8)
  if (totalBuySell > 0) {
    const buyRatio = buys / totalBuySell;
    if (buyRatio >= 0.35 && buyRatio <= 0.65) {
      score += 8;
      reasons.push({
        key: "balanced_trading",
        label: "Balanced buy/sell activity",
        impact: 8,
        detail: `Buy ratio: ${safePct(buyRatio)} (${buys} buys, ${sells} sells). Healthy two-way market.`,
        link: mLink,
      });
    } else if (buyRatio >= 0.25 && buyRatio <= 0.75) {
      score += 5;
      reasons.push({
        key: "slight_skew",
        label: buyRatio > 0.5 ? "Slight buy pressure" : "Slight sell pressure",
        impact: 5,
        detail: `Buy ratio: ${safePct(buyRatio)} (${buys} buys, ${sells} sells).`,
        link: mLink,
      });
    } else if (buyRatio >= 0.15) {
      score += 2;
      reasons.push({
        key: "heavy_skew",
        label: buyRatio > 0.5 ? "Heavy buy skew" : "Heavy sell pressure",
        impact: 2,
        detail: `Buy ratio: ${safePct(buyRatio)} (${buys} buys, ${sells} sells). ${buyRatio < 0.3 ? "Dump risk." : "FOMO buying risk."}`,
        link: mLink,
      });
    } else {
      reasons.push({
        key: "extreme_skew",
        label: buyRatio > 0.5 ? "Extreme buy frenzy" : "Extreme sell-off",
        impact: 0,
        detail: `Buy ratio: ${safePct(buyRatio)} (${buys} buys, ${sells} sells). Unhealthy pattern.`,
        link: mLink,
      });
    }
  }

  // Trade count (max 4)
  if (totalTrades >= 10) {
    score += 4;
    reasons.push({
      key: "active_trades",
      label: "Active recent trading",
      impact: 4,
      detail: `${totalTrades} recent trades captured.`,
      link: mLink,
    });
  } else if (totalTrades >= 5) {
    score += 2;
    reasons.push({
      key: "some_trades",
      label: "Some recent trading",
      impact: 2,
      detail: `${totalTrades} recent trades captured.`,
      link: mLink,
    });
  } else {
    score += 1;
    reasons.push({
      key: "few_trades",
      label: "Minimal recent trading",
      impact: 1,
      detail: `Only ${totalTrades} recent trade(s) captured.`,
      link: mLink,
    });
  }

  // SOL volume presence (max 3)
  if (pump.totalSolVolume > 10) {
    score += 3;
    reasons.push({
      key: "sol_volume_strong",
      label: "Meaningful SOL volume",
      impact: 3,
      detail: `${pump.totalSolVolume.toFixed(2)} SOL in recent trades.`,
      link: mLink,
    });
  } else if (pump.totalSolVolume > 1) {
    score += 1;
    reasons.push({
      key: "sol_volume_low",
      label: "Low SOL volume",
      impact: 1,
      detail: `${pump.totalSolVolume.toFixed(2)} SOL in recent trades.`,
      link: mLink,
    });
  }

  return {
    key: "trading",
    label: "Trading Health",
    score: clamp(score, MAX),
    maxScore: MAX,
    reasons,
  };
}

// ─── Dimension 5: Market Maturity (max 20) ────────────────────────────

function scoreMaturity(
  token: TokenLookupResult,
  canonical: CanonicalMatch | undefined
): TrustDimension {
  const MAX = 20;
  let score = 0;
  const reasons: TrustReason[] = [];
  const matches = token.sameTickerTokens ?? [];
  const mLink = mintExplorerLink(token.id);
  const link = canonical?.url ?? mLink;

  // Pair age (max 10)
  const created = canonical?.pairCreatedAt;
  if (created) {
    const ageHours = (Date.now() - created) / (1000 * 60 * 60);
    const ageDays = ageHours / 24;
    if (ageDays >= 30) {
      score += 10;
      reasons.push({
        key: "mature_pair",
        label: "Mature market pair",
        impact: 10,
        detail: `Pair created ${Math.floor(ageDays)} days ago. Well-established.`,
        link,
      });
    } else if (ageDays >= 7) {
      score += 7;
      reasons.push({
        key: "established_pair",
        label: "Established market pair",
        impact: 7,
        detail: `Pair created ${Math.floor(ageDays)} days ago.`,
        link,
      });
    } else if (ageDays >= 3) {
      score += 4;
      reasons.push({
        key: "young_pair",
        label: "Young market pair",
        impact: 4,
        detail: `Pair created ${Math.floor(ageDays)} days ago. Still early.`,
        link,
      });
    } else if (ageDays >= 1) {
      score += 2;
      reasons.push({
        key: "new_pair",
        label: "New market pair",
        impact: 2,
        detail: `Pair created ${Math.floor(ageHours)} hours ago. Very early stage.`,
        link,
      });
    } else {
      reasons.push({
        key: "fresh_pair",
        label: "Just launched",
        impact: 0,
        detail: `Pair created ${Math.max(1, Math.floor(ageHours))} hour(s) ago. Extreme early stage — high rug risk.`,
        link,
      });
    }
  } else {
    reasons.push({
      key: "unknown_age",
      label: "Unknown pair age",
      impact: 0,
      detail: "No pair creation timestamp available.",
      link,
    });
  }

  // Market cap presence (max 5)
  const mcap = canonical?.marketCapUsd ?? canonical?.fdvUsd ?? 0;
  if (mcap >= 100_000) {
    score += 5;
    reasons.push({
      key: "mcap_substantial",
      label: "Substantial market cap",
      impact: 5,
      detail: `Market cap: ${fmtUsd(mcap)}.`,
      link,
    });
  } else if (mcap >= 10_000) {
    score += 3;
    reasons.push({
      key: "mcap_small",
      label: "Small market cap",
      impact: 3,
      detail: `Market cap: ${fmtUsd(mcap)}.`,
      link,
    });
  } else if (mcap > 0) {
    score += 1;
    reasons.push({
      key: "mcap_micro",
      label: "Micro market cap",
      impact: 1,
      detail: `Market cap: ${fmtUsd(mcap)}.`,
      link,
    });
  }

  // High-risk neighbors (max 5)
  // Dominant tokens aren't dinged for having scam copycats
  const dominant = isDominantForTicker(canonical, matches);
  const highRiskCount = matches.filter((m) => m.risk === "high").length;
  if (highRiskCount === 0) {
    score += 5;
    reasons.push({
      key: "no_high_risk",
      label: "No high-risk neighbors",
      impact: 5,
      detail: "No high-risk same-ticker tokens detected.",
      link,
    });
  } else if (dominant) {
    score += 5;
    reasons.push({
      key: "dominant_ignores_scams",
      label: `${highRiskCount} scam clone(s) — dominant token unaffected`,
      impact: 5,
      detail: `${highRiskCount} high-risk same-ticker tokens exist, but this token leads by liquidity and is not at risk from copycats.`,
      link,
    });
  } else if (highRiskCount <= 2) {
    score += 2;
    reasons.push({
      key: "few_high_risk",
      label: `${highRiskCount} high-risk neighbor(s)`,
      impact: 2,
      detail: "Some high-risk same-ticker tokens detected.",
      link,
    });
  } else {
    reasons.push({
      key: "many_high_risk",
      label: `${highRiskCount} high-risk neighbors`,
      impact: 0,
      detail:
        "Multiple high-risk same-ticker listings increase scam surface area.",
      link,
    });
  }

  return {
    key: "maturity",
    label: "Market Maturity",
    score: clamp(score, MAX),
    maxScore: MAX,
    reasons,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────

export function computeTokenTrustScore(
  token: TokenLookupResult
): TokenTrustScore {
  const canonical = pickCanonicalPair(token);
  const mLink = mintExplorerLink(token.id);

  const dimensions = [
    scoreIdentity(token, canonical),
    scoreLiquidity(token, canonical),
    scoreVolume(token, canonical),
    scoreTradingHealth(token),
    scoreMaturity(token, canonical),
  ];

  const totalScore = dimensions.reduce((sum, d) => sum + d.score, 0);
  const allReasons = dimensions.flatMap((d) => d.reasons);

  const hardLinks: TokenTrustScore["hardLinks"] = {
    mint: mLink,
    pair: canonical?.url,
    tx: canonical?.url ? `${canonical.url}#transactions` : undefined,
    liquidity: canonical?.url ? `${canonical.url}#liquidity` : undefined,
  };

  const finalScore = clamp(totalScore);
  return {
    score: finalScore,
    grade: gradeFromScore(finalScore),
    reasons: allReasons,
    dimensions,
    hardLinks,
  };
}
