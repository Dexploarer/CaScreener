const SOLANA_ADDRESS_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;
const MAJOR_MARKET_SYMBOLS = new Set([
  "btc",
  "bitcoin",
  "eth",
  "ethereum",
  "sol",
  "solana",
  "xrp",
  "bnb",
  "ada",
  "doge",
  "dot",
  "avax",
  "matic",
  "ltc",
  "link",
  "trx",
  "ton",
  "sui",
  "hype",
  "usdt",
  "usdc",
  "dai",
]);

export type QueryType =
  | "wallet"
  | "token"
  | "whale"
  | "market"
  | "prediction"
  | "arbitrage"
  | "alpha"
  | "narrative"
  | "pump"
  | "general";

export function extractSolanaAddress(text: string): string | null {
  const match = text.match(SOLANA_ADDRESS_RE);
  return match ? match[0] : null;
}

export function classifyQuery(prompt: string): QueryType {
  const p = prompt.toLowerCase();
  const trimmed = p.trim();
  const normalizedTicker = trimmed.replace(/^\$/, "");
  const inlineDollarTickerMatch = prompt.match(/\$([A-Za-z][A-Za-z0-9]{1,11})\b/);
  const inlineDollarTicker = inlineDollarTickerMatch?.[1]?.toLowerCase();
  const hasInlineDollarTicker = !!inlineDollarTicker;

  // Slash shortcuts: "/" and pump aliases should open the pump flow.
  if (
    trimmed === "/" ||
    trimmed === "/pump" ||
    trimmed === "/pumpfun" ||
    trimmed === "/pf"
  ) {
    return "pump";
  }
  const detectedAddress = extractSolanaAddress(prompt);
  const hasAddress = !!detectedAddress;

  const isPumpQuery =
    /\b(pump\.?fun|pump\s?fun|pump\s?portal|lets?\s?bonk|bonk\.?fun|pumpswap|new\s?tokens?|token\s?launch(?:es)?|memecoin(?:s)?|memecoin\s?launch(?:es)?|bonding\s?curve|graduat(?:ed|ing|ion)|migration|rug|rugpull|snipe|sniper)\b/.test(
      p
    );

  const hasTickerSafetyIntent =
    /\b(same\s?ticker|similar\s?ticker|ticker\s?check|ticker.*fake|fake.*ticker|fake\s?token|copy|clone|counterfeit|impersonat|scam|is\s+this\s+fake|which\s+token\s+is\s+real)\b/.test(
      p
    );
  const isStandaloneTicker = /^\$?[a-z][a-z0-9]{1,11}$/i.test(trimmed);
  const hasTokenHint =
    hasAddress ||
    hasInlineDollarTicker ||
    isStandaloneTicker ||
    /\b(token|ticker|symbol|mint|contract|ca\b)\b/.test(p);
  const hasTokenSearchIntent = /\b(search|find|show|check|scan|lookup|look\s?up)\b/.test(p);

  // Pump.fun / memecoin launch queries must be classified first.
  // This prevents wallet/market misroutes when prompts include a mint address.
  // Exception: explicit copy/fake/clone checks should route to token intel.
  if (isPumpQuery && hasTickerSafetyIntent && hasTokenHint) return "token";
  if (isPumpQuery) return "pump";

  // Token intelligence / anti-fake checks.
  // Pump-style mint suffixes (e.g. ...pump) are typically token mints, not wallets.
  if (
    detectedAddress &&
    /pump$/i.test(detectedAddress)
  )
    return "token";

  if (
    hasAddress &&
    /\b(token|ticker|mint|contract|ca\b|same\s?ticker|fake|clone|scam|counterfeit)\b/.test(
      p
    )
  )
    return "token";

  if (hasTickerSafetyIntent && hasTokenHint) return "token";

  if (
    hasInlineDollarTicker &&
    !!inlineDollarTicker &&
    !MAJOR_MARKET_SYMBOLS.has(inlineDollarTicker) &&
    (hasTokenHint || hasTokenSearchIntent)
  ) {
    return "token";
  }

  if (
    isStandaloneTicker &&
    !MAJOR_MARKET_SYMBOLS.has(normalizedTicker)
  ) {
    return "token";
  }

  // Whale: Solana address + analytical keywords (deep analysis)
  if (
    hasAddress &&
    /\b(analyze|profile|deep.?dive|strategy|intelligence|classify|breakdown|whale)\b/.test(p)
  )
    return "whale";

  // Wallet: contains Solana address (simple lookup)
  if (hasAddress) return "wallet";

  // Alpha: cross-signal detection keywords
  if (
    /\b(alpha|signal|divergence|mismatch|cross.?signal|anomaly|imbalance|edge(?!r)|opportunit(?:y|ies)|conviction|trust\s?scor(?:e|ing)|clone\s?risk)\b/.test(
      p
    ) &&
    !/\b(arbitrage|arb\b)\b/.test(p)
  )
    return "alpha";

  // Narrative: theme/impact mapping keywords
  if (
    /\b(narrative|theme|impact|what.?would.?move|connect.?dots|big.?picture|macro|scenario)\b/.test(
      p
    )
  )
    return "narrative";

  // Arbitrage: must come before prediction — mentions arb, arbitrage, mispriced, edge
  if (
    /\b(arbitrage|arb\b|mispriced|misprice|cross.?platform|price.?difference|risk.?free|guaranteed.?profit|arb.?opportunity|arb.?play)\b/.test(
      p
    )
  )
    return "arbitrage";

  // Prediction: mentions prediction markets, odds, polymarket, elections
  if (
    /polymarket|prediction market|odds|betting market|will .+ win|probability of|forecast|election|resolve to|prediction/.test(
      p
    )
  )
    return "prediction";

  // Market: crypto-related queries
  if (
    /\b(btc|bitcoin|eth|ethereum|sol|solana|crypto|market|price|chart|dominance|volume|mcap|market.?cap|defi|tvl|token|coin|altcoin|memecoin|trading|bullish|bearish|whale|pump|dump|ath|dip|rally|breakout|support|resistance|funding|liquidat|short|long|leverage|perpetual|futures|spot|swap|dex|cex|binance|coinbase|stablecoin|usdt|usdc|nft|airdrop|stake|yield|apr|apy|lending|borrow)\b/.test(
      p
    )
  )
    return "market";

  return "general";
}
