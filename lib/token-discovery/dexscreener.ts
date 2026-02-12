import { isValidSolanaAddress } from "@/lib/helius/validation";

const DEXSCREENER_API_BASE =
  process.env.DEXSCREENER_API_BASE?.trim() || "https://api.dexscreener.com";
const REQUEST_TIMEOUT_MS = 8_000;

type DexToken = {
  address?: string;
  name?: string;
  symbol?: string;
};

type DexPairInfo = {
  imageUrl?: string;
  header?: string;
  openGraph?: string;
};

type DexPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  pairCreatedAt?: number;
  priceUsd?: string;
  fdv?: number;
  marketCap?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  baseToken?: DexToken;
  quoteToken?: DexToken;
  info?: DexPairInfo;
};

type DexPairsResponse = { pairs?: DexPair[] };

type PairMatchCandidate = {
  mint: string;
  symbol: string;
  name?: string;
  pair: DexPair;
};

export type TokenTickerMatch = {
  symbol: string;
  name?: string;
  mint: string;
  imageUri?: string;
  imageUris?: string[];
  dexId?: string;
  pairAddress?: string;
  url?: string;
  priceUsd?: number;
  liquidityUsd?: number;
  volume24hUsd?: number;
  fdvUsd?: number;
  marketCapUsd?: number;
  pairCreatedAt?: number;
  pairCount: number;
  isExactMintMatch: boolean;
  risk: "canonical" | "low" | "medium" | "high";
  riskReasons: string[];
};

export type TokenTickerDiscovery = {
  mode: "mint" | "ticker";
  query: string;
  ticker: string;
  canonicalMint?: string;
  rawPairCount: number;
  matches: TokenTickerMatch[];
};

type FindByTickerInput = {
  query: string;
  canonicalMint?: string;
  fallbackSymbol?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeSymbol(value: string | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function normalizeImageUri(value: string | undefined): string | undefined {
  const uri = value?.trim();
  if (!uri) return undefined;
  if (/^https?:\/\//i.test(uri)) return uri;
  if (/^ipfs:\/\//i.test(uri)) return uri;
  return undefined;
}

export function mergeImageUris(
  ...groups: Array<ReadonlyArray<string | undefined> | undefined>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    if (!group) continue;
    for (const raw of group) {
      const uri = normalizeImageUri(raw);
      if (!uri) continue;
      const key = uri.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(uri);
    }
  }
  return out;
}

function collectPairImageUris(pair: DexPair): string[] {
  return mergeImageUris([
    pair.info?.imageUrl,
    pair.info?.header,
    pair.info?.openGraph,
  ]);
}

export function isLikelyTickerQuery(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  if (isValidSolanaAddress(s)) return false;
  return /^[A-Za-z0-9._-]{1,20}$/.test(s);
}

function pairLiquidity(pair: DexPair): number {
  return asFiniteNumber(pair.liquidity?.usd) ?? 0;
}

function pairVolume24h(pair: DexPair): number {
  return asFiniteNumber(pair.volume?.h24) ?? 0;
}

function pairPriceUsd(pair: DexPair): number | undefined {
  return asFiniteNumber(pair.priceUsd);
}

function pairFdv(pair: DexPair): number | undefined {
  return asFiniteNumber(pair.fdv);
}

function pairMarketCap(pair: DexPair): number | undefined {
  return asFiniteNumber(pair.marketCap);
}

function pairCreatedAt(pair: DexPair): number | undefined {
  return asFiniteNumber(pair.pairCreatedAt);
}

function comparePairs(a: DexPair, b: DexPair): number {
  const liqDiff = pairLiquidity(b) - pairLiquidity(a);
  if (liqDiff !== 0) return liqDiff;
  const volDiff = pairVolume24h(b) - pairVolume24h(a);
  if (volDiff !== 0) return volDiff;
  return (pairCreatedAt(b) ?? 0) - (pairCreatedAt(a) ?? 0);
}

function tokenFromPair(
  pair: DexPair,
  mint: string
): DexToken | null {
  const lower = mint.toLowerCase();
  if (pair.baseToken?.address?.toLowerCase() === lower) return pair.baseToken;
  if (pair.quoteToken?.address?.toLowerCase() === lower) return pair.quoteToken;
  return null;
}

function scoreRisk(
  pair: DexPair,
  pairCount: number,
  isExactMintMatch: boolean
): { risk: TokenTickerMatch["risk"]; reasons: string[] } {
  if (isExactMintMatch) {
    return { risk: "canonical", reasons: ["Exact mint match"] };
  }

  let score = 0;
  const reasons: string[] = [];

  const liq = pairLiquidity(pair);
  if (liq < 5_000) {
    score += 2;
    reasons.push("Very low liquidity");
  } else if (liq < 25_000) {
    score += 1;
    reasons.push("Low liquidity");
  }

  const vol24 = pairVolume24h(pair);
  if (vol24 < 1_000) {
    score += 2;
    reasons.push("Very low 24h volume");
  } else if (vol24 < 10_000) {
    score += 1;
    reasons.push("Low 24h volume");
  }

  const created = pairCreatedAt(pair);
  if (created) {
    const ageHours = (Date.now() - created) / (1000 * 60 * 60);
    if (ageHours < 24) {
      score += 2;
      reasons.push("Recently created pair");
    } else if (ageHours < 72) {
      score += 1;
      reasons.push("New pair");
    }
  }

  const fdv = pairFdv(pair);
  if (fdv && liq > 0 && fdv / liq > 250) {
    score += 1;
    reasons.push("FDV/liquidity imbalance");
  }

  if (pairCount > 3) {
    score += 1;
    reasons.push("Many duplicate market pairs");
  }

  if (score >= 4) return { risk: "high", reasons };
  if (score >= 2) return { risk: "medium", reasons };
  return {
    risk: "low",
    reasons: reasons.length > 0 ? reasons : ["Healthy liquidity/volume profile"],
  };
}

function safeEncode(value: string): string {
  return encodeURIComponent(value.trim());
}

async function fetchDexPairs(path: string): Promise<DexPair[]> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${DEXSCREENER_API_BASE}${path}`, {
      method: "GET",
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as DexPairsResponse | unknown;
    if (!isRecord(json)) return [];
    const pairs = (json as DexPairsResponse).pairs;
    if (!Array.isArray(pairs)) return [];
    return pairs;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function searchPairsByTicker(ticker: string): Promise<DexPair[]> {
  return fetchDexPairs(`/latest/dex/search?q=${safeEncode(ticker)}`);
}

function pairDedupKey(pair: DexPair): string {
  return [
    pair.pairAddress?.toLowerCase() ?? "",
    pair.url?.toLowerCase() ?? "",
    pair.dexId?.toLowerCase() ?? "",
    pair.baseToken?.address?.toLowerCase() ?? "",
    pair.quoteToken?.address?.toLowerCase() ?? "",
  ].join("|");
}

function dedupePairs(pairs: DexPair[]): DexPair[] {
  const seen = new Set<string>();
  const out: DexPair[] = [];
  for (const pair of pairs) {
    const key = pairDedupKey(pair);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pair);
  }
  return out;
}

async function searchPairsByTickerVariants(ticker: string): Promise<DexPair[]> {
  if (!ticker) return [];
  const [plain, dollarPrefixed] = await Promise.all([
    searchPairsByTicker(ticker),
    searchPairsByTicker(`$${ticker}`),
  ]);
  return dedupePairs([...plain, ...dollarPrefixed]);
}

async function getPairsByMint(mint: string): Promise<DexPair[]> {
  return fetchDexPairs(`/latest/dex/tokens/${safeEncode(mint)}`);
}

function toMatch(
  pair: DexPair,
  pairCount: number,
  canonicalMint: string | undefined,
  imageUris: string[] = collectPairImageUris(pair)
): TokenTickerMatch | null {
  const base = pair.baseToken;
  const mint = base?.address?.trim();
  const symbol = normalizeSymbol(base?.symbol);
  if (!mint || !symbol) return null;

  const isExactMintMatch =
    !!canonicalMint && canonicalMint.toLowerCase() === mint.toLowerCase();
  const risk = scoreRisk(pair, pairCount, isExactMintMatch);

  return {
    symbol,
    name: base?.name?.trim() || undefined,
    mint,
    imageUri: imageUris[0],
    imageUris: imageUris.length > 0 ? imageUris : undefined,
    dexId: pair.dexId,
    pairAddress: pair.pairAddress,
    url: pair.url,
    priceUsd: pairPriceUsd(pair),
    liquidityUsd: pairLiquidity(pair),
    volume24hUsd: pairVolume24h(pair),
    fdvUsd: pairFdv(pair),
    marketCapUsd: pairMarketCap(pair),
    pairCreatedAt: pairCreatedAt(pair),
    pairCount,
    isExactMintMatch,
    risk: risk.risk,
    riskReasons: risk.reasons,
  };
}

function toCanonicalMatchFromDirectPairs(
  pairs: DexPair[],
  mint: string,
  fallbackTicker: string
): TokenTickerMatch | null {
  const solanaPairs = pairs.filter(
    (p) => p.chainId?.toLowerCase() === "solana" && tokenFromPair(p, mint)
  );
  if (solanaPairs.length === 0) {
    if (!fallbackTicker) return null;
    return {
      symbol: fallbackTicker,
      mint,
      pairCount: 0,
      isExactMintMatch: true,
      risk: "canonical",
      riskReasons: ["Exact mint match"],
    };
  }

  solanaPairs.sort(comparePairs);
  const best = solanaPairs[0];
  const token = tokenFromPair(best, mint);
  if (!token) return null;

  const imageUris = mergeImageUris(...solanaPairs.map(collectPairImageUris));
  return {
    symbol: normalizeSymbol(token.symbol) || fallbackTicker,
    name: token.name?.trim() || undefined,
    mint,
    imageUri: imageUris[0],
    imageUris: imageUris.length > 0 ? imageUris : undefined,
    dexId: best.dexId,
    pairAddress: best.pairAddress,
    url: best.url,
    priceUsd: pairPriceUsd(best),
    liquidityUsd: pairLiquidity(best),
    volume24hUsd: pairVolume24h(best),
    fdvUsd: pairFdv(best),
    marketCapUsd: pairMarketCap(best),
    pairCreatedAt: pairCreatedAt(best),
    pairCount: solanaPairs.length,
    isExactMintMatch: true,
    risk: "canonical",
    riskReasons: ["Exact mint match"],
  };
}

function tokenCandidatesForTicker(pair: DexPair, ticker: string): PairMatchCandidate[] {
  const out: PairMatchCandidate[] = [];
  if (pair.chainId?.toLowerCase() !== "solana") return out;

  const baseSymbol = normalizeSymbol(pair.baseToken?.symbol);
  const baseMint = pair.baseToken?.address?.trim();
  if (baseSymbol === ticker && baseMint) {
    out.push({
      mint: baseMint,
      symbol: ticker,
      name: pair.baseToken?.name?.trim() || undefined,
      pair,
    });
  }

  const quoteSymbol = normalizeSymbol(pair.quoteToken?.symbol);
  const quoteMint = pair.quoteToken?.address?.trim();
  if (quoteSymbol === ticker && quoteMint) {
    out.push({
      mint: quoteMint,
      symbol: ticker,
      name: pair.quoteToken?.name?.trim() || undefined,
      pair,
    });
  }

  return out;
}

function buildMatches(
  pairs: DexPair[],
  ticker: string,
  canonicalMint: string | undefined
): TokenTickerMatch[] {
  const grouped = new Map<string, { pairs: DexPair[]; name?: string }>();
  for (const pair of pairs) {
    const candidates = tokenCandidatesForTicker(pair, ticker);
    for (const candidate of candidates) {
      const bucket = grouped.get(candidate.mint) ?? { pairs: [], name: undefined };
      bucket.pairs.push(candidate.pair);
      if (!bucket.name && candidate.name) bucket.name = candidate.name;
      grouped.set(candidate.mint, bucket);
    }
  }

  const matches: TokenTickerMatch[] = [];
  for (const [mint, bucket] of grouped.entries()) {
    const groupedPairs = bucket.pairs;
    groupedPairs.sort(comparePairs);
    const best = groupedPairs[0];
    const imageUris = mergeImageUris(...groupedPairs.map(collectPairImageUris));
    const match = toMatch(
      {
        ...best,
        baseToken: {
          ...best.baseToken,
          address: mint,
          symbol: ticker,
          name: bucket.name ?? best.baseToken?.name ?? best.quoteToken?.name,
        },
      },
      groupedPairs.length,
      canonicalMint,
      imageUris
    );
    if (match) matches.push(match);
  }

  return matches.sort((a, b) => {
    if (a.isExactMintMatch && !b.isExactMintMatch) return -1;
    if (!a.isExactMintMatch && b.isExactMintMatch) return 1;
    const riskOrder: Record<TokenTickerMatch["risk"], number> = {
      canonical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    const riskDiff = riskOrder[a.risk] - riskOrder[b.risk];
    if (riskDiff !== 0) return riskDiff;
    const liqDiff = (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0);
    if (liqDiff !== 0) return liqDiff;
    return (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0);
  });
}

export async function findSolanaTokensByTicker(
  input: FindByTickerInput
): Promise<TokenTickerDiscovery> {
  const query = input.query.trim();
  const canonicalMint = input.canonicalMint?.trim();
  const mode: "mint" | "ticker" =
    canonicalMint || isValidSolanaAddress(query) ? "mint" : "ticker";

  let ticker = normalizeSymbol(input.fallbackSymbol);
  let pairs: DexPair[] = [];

  let directPairs: DexPair[] = [];
  if (mode === "mint") {
    const mint = canonicalMint || query;
    directPairs = await getPairsByMint(mint);
    pairs = directPairs;
    if (!ticker) {
      const directSolana = directPairs
        .filter((p) => p.chainId?.toLowerCase() === "solana")
        .sort(comparePairs);
      const exact = directSolana.find((p) => tokenFromPair(p, mint));
      const exactToken = exact ? tokenFromPair(exact, mint) : null;
      ticker = normalizeSymbol(exactToken?.symbol);
      if (!ticker && directSolana[0]?.baseToken?.symbol) {
        ticker = normalizeSymbol(directSolana[0].baseToken?.symbol);
      }
    }

    if (ticker) {
      const searchPairs = await searchPairsByTickerVariants(ticker);
      if (searchPairs.length > 0) {
        pairs = searchPairs;
      }
    }
  } else {
    ticker = normalizeSymbol(query);
    pairs = ticker ? await searchPairsByTickerVariants(ticker) : [];
  }

  const effectiveCanonicalMint =
    canonicalMint || (mode === "mint" ? query : undefined);
  const matches = ticker
    ? buildMatches(pairs, ticker, effectiveCanonicalMint)
    : [];
  if (mode === "mint" && effectiveCanonicalMint) {
    const hasCanonical = matches.some(
      (m) => m.mint.toLowerCase() === effectiveCanonicalMint.toLowerCase()
    );
    if (!hasCanonical) {
      const canonicalMatch = toCanonicalMatchFromDirectPairs(
        directPairs,
        effectiveCanonicalMint,
        ticker
      );
      if (canonicalMatch) {
        matches.unshift(canonicalMatch);
      }
    }
  }

  return {
    mode,
    query,
    ticker,
    canonicalMint: effectiveCanonicalMint,
    rawPairCount: pairs.length,
    matches,
  };
}
