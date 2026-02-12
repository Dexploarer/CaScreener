import type { PredictionMarket } from "@/lib/predictions/types";
import type { CoinMarketData, GlobalData } from "@/lib/market-data/coingecko";
import { questionMatchesKeywords } from "./shared";

// ── Types ────────────────────────────────────────────────────────

export type NarrativeTheme = {
  id: string;
  name: string;
  keywords: string[];
  impactedTokens: string[]; // CoinGecko IDs
  description: string;
};

export type TokenImpact = {
  coinId: string;
  coinName: string;
  coinSymbol: string;
  currentPrice: number;
  change24h: number | null;
  change7d: number | null;
  impactDirection: "positive" | "negative" | "neutral";
  reasoning: string;
};

export type Narrative = {
  theme: NarrativeTheme;
  matchedMarkets: PredictionMarket[];
  avgConfidence: number;
  momentum: number; // -1 to 1, derived from market YES prices trending
  volumeSignal: number; // normalized 0-1 based on relative volume
  compositeScore: number;
  tokenImpacts: TokenImpact[];
  summary: string;
};

export type NarrativeReport = {
  narratives: Narrative[];
  totalMarketsAnalyzed: number;
  totalThemesMatched: number;
  timestamp: string;
};

// ── Narrative Themes ─────────────────────────────────────────────

export const NARRATIVE_THEMES: NarrativeTheme[] = [
  {
    id: "btc-etf",
    name: "Bitcoin ETF / Institutional Adoption",
    keywords: ["bitcoin etf", "btc etf", "spot bitcoin", "institutional bitcoin", "blackrock bitcoin", "bitcoin fund"],
    impactedTokens: ["bitcoin"],
    description: "Spot Bitcoin ETF approval/flows and institutional adoption signals",
  },
  {
    id: "sol-etf",
    name: "Solana ETF",
    keywords: ["solana etf", "sol etf", "spot solana"],
    impactedTokens: ["solana"],
    description: "Solana ETF applications and approval prospects",
  },
  {
    id: "eth-etf",
    name: "Ethereum ETF / Staking",
    keywords: ["ethereum etf", "eth etf", "eth staking", "ethereum staking"],
    impactedTokens: ["ethereum"],
    description: "Ethereum ETF developments and staking rule changes",
  },
  {
    id: "us-regulation",
    name: "US Crypto Regulation",
    keywords: ["crypto regulation", "sec crypto", "crypto bill", "crypto ban", "crypto law", "stablecoin bill", "crypto executive order"],
    impactedTokens: ["bitcoin", "ethereum", "solana", "ripple", "uniswap"],
    description: "US regulatory clarity or crackdowns affecting the entire market",
  },
  {
    id: "rate-cuts",
    name: "Rate Cuts / Macro",
    keywords: ["rate cut", "interest rate", "fed rate", "federal reserve", "recession", "inflation", "cpi", "monetary policy"],
    impactedTokens: ["bitcoin", "ethereum", "solana"],
    description: "Federal Reserve rate decisions and macro economic conditions affecting risk assets",
  },
  {
    id: "stablecoin-reg",
    name: "Stablecoin Regulation",
    keywords: ["stablecoin", "usdc regulation", "tether", "usdt ban", "stablecoin bill", "cbdc"],
    impactedTokens: ["usd-coin", "tether"],
    description: "Stablecoin legislative and regulatory developments",
  },
  {
    id: "defi-regulation",
    name: "DeFi Regulation",
    keywords: ["defi regulation", "defi crackdown", "uniswap sec", "dex regulation", "defi compliance"],
    impactedTokens: ["uniswap", "aave"],
    description: "DeFi-specific regulatory actions and compliance requirements",
  },
  {
    id: "chain-upgrades",
    name: "Chain Upgrades / Technical",
    keywords: ["ethereum upgrade", "solana upgrade", "dencun", "pectra", "firedancer", "layer 2", "rollup"],
    impactedTokens: ["ethereum", "solana", "arbitrum", "optimism"],
    description: "Major blockchain protocol upgrades and technical milestones",
  },
  {
    id: "memecoin",
    name: "Memecoin Regulation / Mania",
    keywords: ["memecoin", "meme coin", "doge", "pepe", "bonk", "wif", "dogwifhat", "shib", "shiba", "floki", "popcat", "trump coin", "trump token", "memecoin ban", "meme regulation"],
    impactedTokens: ["dogecoin", "pepe", "bonk", "dogwifhat", "shiba-inu", "floki"],
    description: "Memecoin regulatory risk or cultural momentum",
  },
  {
    id: "ai-crypto",
    name: "AI + Crypto Convergence",
    keywords: ["ai crypto", "artificial intelligence blockchain", "ai token", "machine learning crypto", "decentralized ai", "ai agent", "ai compute", "gpu network", "render", "rndr", "fetch", "fet", "bittensor", "tao", "akash", "akt", "artificial superintelligence"],
    impactedTokens: ["render-token", "near", "fetch-ai", "bittensor", "akash-network"],
    description: "Intersection of AI and crypto, including AI tokens, decentralized compute, and AI agent infrastructure",
  },
  {
    id: "us-elections",
    name: "US Elections Impact on Crypto",
    keywords: ["election crypto", "trump crypto", "biden crypto", "president crypto", "crypto president", "election bitcoin"],
    impactedTokens: ["bitcoin", "ethereum", "solana"],
    description: "US election outcomes and their implications for crypto policy",
  },
  {
    id: "xrp-legal",
    name: "XRP / Ripple Legal",
    keywords: ["ripple sec", "xrp lawsuit", "ripple settlement", "xrp ruling"],
    impactedTokens: ["ripple"],
    description: "Ripple vs SEC legal proceedings and settlement prospects",
  },
  {
    id: "global-adoption",
    name: "Global Crypto Adoption",
    keywords: ["bitcoin legal tender", "crypto adoption", "cbdc launch", "crypto country", "bitcoin reserve"],
    impactedTokens: ["bitcoin", "ethereum"],
    description: "National-level crypto adoption and strategic reserve policies",
  },
  {
    id: "exchange-risk",
    name: "Exchange Risk / CeFi",
    keywords: ["exchange hack", "binance risk", "coinbase sec", "exchange ban", "exchange regulation", "cefi"],
    impactedTokens: ["bitcoin", "ethereum", "binancecoin"],
    description: "Centralized exchange regulatory risks and security incidents",
  },
  {
    id: "l2-scaling",
    name: "Layer 2 Scaling Race",
    keywords: ["layer 2", "l2", "arbitrum", "optimism", "base", "zksync", "rollup", "scaling"],
    impactedTokens: ["arbitrum", "optimism", "ethereum"],
    description: "Layer 2 adoption metrics, competition, and impact on Ethereum",
  },
];

// ── Core Functions ───────────────────────────────────────────────

/**
 * Match prediction markets to narrative themes and compute signals.
 */
export function matchMarketsToNarratives(
  markets: PredictionMarket[],
  coins: CoinMarketData[],
  themes: NarrativeTheme[] = NARRATIVE_THEMES
): Narrative[] {
  const narratives: Narrative[] = [];

  // Pre-index coins for quick lookup
  const coinMap = new Map<string, CoinMarketData>();
  for (const c of coins) coinMap.set(c.id, c);

  // Total volume for normalization
  const totalVolume = markets.reduce((s, m) => s + (m.volume ?? 0), 0);

  for (const theme of themes) {
    const matched = markets.filter((m) =>
      questionMatchesKeywords(m.question, theme.keywords)
    );
    if (matched.length === 0) continue;

    // Time-decay: filter out resolved/expired markets and down-weight near-expiry
    const now = Date.now();
    const liveMatched = matched.filter((m) => {
      if (m.isResolved) return false;
      if (m.endDate) {
        const end = new Date(m.endDate).getTime();
        // Exclude markets that ended more than 24h ago (stale)
        if (end < now - 86_400_000) return false;
      }
      return true;
    });
    if (liveMatched.length === 0) continue;

    // Average confidence (YES price)
    const avgConfidence =
      liveMatched.reduce((s, m) => s + m.yesPrice, 0) / liveMatched.length;

    // Momentum: how much above/below 50% the markets lean
    // -1 = all bearish, +1 = all bullish
    const momentum =
      liveMatched.reduce((s, m) => s + (m.yesPrice - 0.5) * 2, 0) /
      liveMatched.length;

    // Volume signal: what fraction of total volume these markets represent
    const themeVolume = liveMatched.reduce((s, m) => s + (m.volume ?? 0), 0);
    const volumeSignal = totalVolume > 0 ? themeVolume / totalVolume : 0;

    // Token impacts
    const tokenImpacts: TokenImpact[] = [];
    for (const tokenId of theme.impactedTokens) {
      const coin = coinMap.get(tokenId);
      if (!coin) continue;

      // Determine impact direction from market confidence
      const impactDirection: TokenImpact["impactDirection"] =
        avgConfidence > 0.6
          ? "positive"
          : avgConfidence < 0.4
            ? "negative"
            : "neutral";

      tokenImpacts.push({
        coinId: coin.id,
        coinName: coin.name,
        coinSymbol: coin.symbol.toUpperCase(),
        currentPrice: coin.current_price,
        change24h: coin.price_change_percentage_24h,
        change7d: coin.price_change_percentage_7d_in_currency ?? null,
        impactDirection,
        reasoning: `${theme.name} narrative at ${(avgConfidence * 100).toFixed(0)}% confidence — ${impactDirection} for ${coin.symbol.toUpperCase()}`,
      });
    }

    const summary = `${theme.name}: ${liveMatched.length} market${liveMatched.length === 1 ? "" : "s"} tracking this narrative. Average confidence ${(avgConfidence * 100).toFixed(0)}%, momentum ${momentum > 0 ? "+" : ""}${(momentum * 100).toFixed(0)}%.`;

    narratives.push({
      theme,
      matchedMarkets: liveMatched,
      avgConfidence,
      momentum,
      volumeSignal,
      compositeScore: 0, // scored in next step
      tokenImpacts,
      summary,
    });
  }

  return narratives;
}

/**
 * Score narratives with composite: confidence * 40 + volumeSignal * 30 + momentum * 30
 */
export function scoreNarratives(narratives: Narrative[]): Narrative[] {
  // Normalize volumeSignal across narratives (0-1 relative)
  const maxVol = Math.max(...narratives.map((n) => n.volumeSignal), 0.001);

  for (const n of narratives) {
    const normalizedVol = n.volumeSignal / maxVol;
    // Strong momentum in either direction is more signal-worthy than flat
    const normalizedMomentum = Math.abs(n.momentum); // [-1,1] → [0,1]
    n.compositeScore =
      n.avgConfidence * 40 +
      normalizedVol * 30 +
      normalizedMomentum * 30;
  }

  return narratives.sort((a, b) => b.compositeScore - a.compositeScore);
}

/**
 * Master function: generate narrative report.
 */
export function generateNarrativeReport(
  markets: PredictionMarket[],
  coins: CoinMarketData[],
  globalData: GlobalData | null
): NarrativeReport {
  const narratives = matchMarketsToNarratives(markets, coins);
  const scored = scoreNarratives(narratives);

  return {
    narratives: scored,
    totalMarketsAnalyzed: markets.length,
    totalThemesMatched: scored.length,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Serialize narrative report for LLM context injection.
 */
export function serializeNarrativeForLLM(
  report: NarrativeReport,
  prompt: string
): string {
  const parts: string[] = [];
  parts.push(`User asked: "${prompt}"`);
  parts.push(
    `\nNARRATIVE ENGINE REPORT (${report.totalMarketsAnalyzed} markets analyzed, ${report.totalThemesMatched} themes matched)`
  );

  if (report.narratives.length === 0) {
    parts.push(
      `\nNo active narrative themes detected in current prediction markets. The market may be in a low-catalyst period.`
    );
    return parts.join("\n");
  }

  for (const n of report.narratives) {
    parts.push(`\n--- ${n.theme.name} (Score: ${n.compositeScore.toFixed(1)}/100) ---`);
    parts.push(`  ${n.summary}`);
    parts.push(`  Markets: ${n.matchedMarkets.length}`);
    parts.push(`  Avg Confidence: ${(n.avgConfidence * 100).toFixed(1)}%`);
    parts.push(
      `  Momentum: ${n.momentum > 0 ? "+" : ""}${(n.momentum * 100).toFixed(1)}%`
    );
    parts.push(
      `  Volume Signal: ${(n.volumeSignal * 100).toFixed(2)}% of total market volume`
    );

    if (n.tokenImpacts.length > 0) {
      parts.push(`  Token Impacts:`);
      for (const t of n.tokenImpacts) {
        const change24 =
          t.change24h != null ? `${t.change24h >= 0 ? "+" : ""}${t.change24h.toFixed(2)}%` : "N/A";
        const change7d =
          t.change7d != null ? `${t.change7d >= 0 ? "+" : ""}${t.change7d.toFixed(2)}%` : "N/A";
        parts.push(
          `    - ${t.coinSymbol} ($${t.currentPrice.toLocaleString()}) | 24h: ${change24} | 7d: ${change7d} | Impact: ${t.impactDirection} | ${t.reasoning}`
        );
      }
    }

    parts.push(`  Key Markets:`);
    for (const m of n.matchedMarkets.slice(0, 3)) {
      parts.push(
        `    - "${m.question}" | YES: ${(m.yesPrice * 100).toFixed(1)}% | Vol: $${(m.volume ?? 0).toLocaleString()}`
      );
    }
  }

  return parts.join("\n");
}
