import type { TokenLookupResult } from "@/lib/helius/types";

export type TrustReason = {
  key: string;
  label: string;
  impact: number;
  detail: string;
  link?: string;
};

export type TokenTrustScore = {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  reasons: TrustReason[];
  hardLinks: {
    mint: string;
    pair?: string;
    tx?: string;
    liquidity?: string;
  };
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function gradeFromScore(score: number): TokenTrustScore["grade"] {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

function pickCanonicalPair(
  token: TokenLookupResult
): NonNullable<TokenLookupResult["sameTickerTokens"]>[number] | undefined {
  const matches = token.sameTickerTokens ?? [];
  return (
    matches.find((m) => m.isExactMintMatch) ??
    matches.slice().sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))[0]
  );
}

function safePct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function computeTokenTrustScore(token: TokenLookupResult): TokenTrustScore {
  const reasons: TrustReason[] = [];
  let score = 100;
  const matches = token.sameTickerTokens ?? [];
  const total = token.sameTickerCount ?? matches.length;
  const suspicious = token.suspiciousTickerCount ?? 0;
  const suspiciousRatio = total > 0 ? suspicious / total : 0;
  const canonical = pickCanonicalPair(token);

  const mintLink = `https://explorer.solana.com/address/${token.id}`;
  const hardLinks: TokenTrustScore["hardLinks"] = {
    mint: mintLink,
    pair: canonical?.url,
    tx: canonical?.url ? `${canonical.url}#transactions` : undefined,
    liquidity: canonical?.url ? `${canonical.url}#liquidity` : undefined,
  };

  if (!canonical) {
    score -= 18;
    reasons.push({
      key: "no_canonical_pair",
      label: "No canonical market pair found",
      impact: -18,
      detail: "Could not verify an obvious primary Solana market pair from current market data.",
      link: mintLink,
    });
  } else if (!canonical.isExactMintMatch && token.lookupMode === "ticker") {
    score -= 12;
    reasons.push({
      key: "ticker_not_exact",
      label: "Ticker lookup resolved to non-exact mint",
      impact: -12,
      detail: "Ticker search did not produce a clear exact-mint canonical result.",
      link: canonical.url ?? mintLink,
    });
  }

  if (suspicious > 0) {
    const penalty = Math.min(40, suspicious * 8);
    score -= penalty;
    reasons.push({
      key: "suspicious_competitors",
      label: `${suspicious} suspicious same-ticker competitors`,
      impact: -penalty,
      detail: `Found ${suspicious}/${Math.max(total, 1)} medium/high-risk tokens sharing this ticker.`,
      link: canonical?.url ?? mintLink,
    });
  }

  if (suspiciousRatio >= 0.4) {
    const penalty = 12;
    score -= penalty;
    reasons.push({
      key: "high_suspicious_ratio",
      label: "High clone ratio",
      impact: -penalty,
      detail: `${safePct(suspiciousRatio)} of same-ticker listings are medium/high risk.`,
      link: canonical?.url ?? mintLink,
    });
  }

  if (total >= 8) {
    const penalty = Math.min(14, (total - 7) * 2);
    score -= penalty;
    reasons.push({
      key: "crowded_ticker",
      label: "Crowded ticker namespace",
      impact: -penalty,
      detail: `${total} listings share this ticker, increasing impersonation risk.`,
      link: canonical?.url ?? mintLink,
    });
  }

  const canonicalLiquidity = canonical?.liquidityUsd ?? 0;
  if (canonical && canonicalLiquidity > 0 && canonicalLiquidity < 25_000) {
    const penalty = canonicalLiquidity < 5_000 ? 14 : 8;
    score -= penalty;
    reasons.push({
      key: "low_canonical_liquidity",
      label: "Low canonical liquidity",
      impact: -penalty,
      detail: `Primary pair liquidity is ${canonicalLiquidity.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      })} USD.`,
      link: canonical.url,
    });
  }

  const highRiskCount = matches.filter((m) => m.risk === "high").length;
  if (highRiskCount > 0) {
    const penalty = Math.min(15, highRiskCount * 5);
    score -= penalty;
    reasons.push({
      key: "high_risk_neighbours",
      label: `${highRiskCount} high-risk neighbour tokens`,
      impact: -penalty,
      detail: "Multiple high-risk same-ticker listings increase confusion and scam surface area.",
      link: canonical?.url ?? mintLink,
    });
  }

  if (canonical?.isExactMintMatch) {
    score += 3;
    reasons.push({
      key: "exact_match_bonus",
      label: "Exact mint matched",
      impact: 3,
      detail: "Scan identified a canonical pair for this exact mint.",
      link: canonical.url ?? mintLink,
    });
  }

  const finalScore = clampScore(score);
  return {
    score: finalScore,
    grade: gradeFromScore(finalScore),
    reasons,
    hardLinks,
  };
}
