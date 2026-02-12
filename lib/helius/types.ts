/**
 * Shared Helius lookup types for API and UI.
 * Used by /api/helius/lookup, /api/helius/generate-dashboard, and app/helius.
 */

export type LookupType = "wallet" | "transaction" | "token" | "nft";

export type AlliumEnrichmentShape = {
  totalTxCount?: number;
  firstSeen?: string;
  lastActive?: string;
  chains?: string[];
  labels?: string[];
  stats?: Record<string, string | number>;
};

export type WalletAnalyticsShape = {
  address: string;
  solBalance: number;
  solBalanceLamports: number;
  transactions: Array<{
    signature: string;
    slot: number;
    blockTime: number | null;
    err: unknown;
    confirmationStatus?: string;
    description?: string;
    type?: string;
  }>;
  transactionCount: number;
  tokenAccounts: Array<{
    address: string;
    mint: string;
    owner: string;
    amount: number;
    frozen?: boolean;
    symbol?: string;
    decimals?: number;
    name?: string;
  }>;
  tokenCount: number;
  nfts: Array<{
    id: string;
    name?: string;
    image?: string;
    interface?: string;
  }>;
  nftCount: number;
  alliumEnrichment?: AlliumEnrichmentShape;
};

export type WalletLookupResult = WalletAnalyticsShape & { resultType: "wallet" };

export type TransactionLookupResult = {
  resultType: "transaction";
  signature: string;
  slot: number;
  blockTime: number | null;
  fee: number | null;
  feePayer: string | null;
  err: unknown;
  description?: string;
  type?: string;
  source?: string;
  alliumEnrichment?: AlliumEnrichmentShape;
};

export type TokenLookupResult = {
  resultType: "token";
  id: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  imageUri?: string;
  imageUris?: string[];
  lookupMode?: "mint" | "ticker";
  searchedTicker?: string;
  canonicalMint?: string;
  sameTickerCount?: number;
  sameTickerImageCount?: number;
  suspiciousTickerCount?: number;
  trustScore?: {
    score: number;
    grade: "A" | "B" | "C" | "D" | "F";
    reasons: Array<{
      key: string;
      label: string;
      impact: number;
      detail: string;
      link?: string;
    }>;
    dimensions?: Array<{
      key: string;
      label: string;
      score: number;
      maxScore: number;
      reasons: Array<{
        key: string;
        label: string;
        impact: number;
        detail: string;
        link?: string;
      }>;
    }>;
    hardLinks: {
      mint: string;
      pair?: string;
      tx?: string;
      liquidity?: string;
    };
  };
  pumpPortal?: {
    mint: string;
    capturedAt: string;
    recentTradeCount: number;
    buyCount: number;
    sellCount: number;
    createCount: number;
    totalSolVolume: number;
    latestMarketCapSol?: number;
    recentTrades?: Array<{
      signature: string;
      txType?: "buy" | "sell" | "create";
      solAmount?: number;
      tokenAmount?: number;
      marketCapSol?: number;
      timestamp?: number;
      traderPublicKey?: string;
      uri?: string;
      name?: string;
      symbol?: string;
    }>;
  };
  sameTickerTokens?: Array<{
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
  }>;
};

export type NftLookupResult = {
  resultType: "nft";
  id: string;
  name?: string;
  symbol?: string;
  imageUri?: string;
  interface?: string;
};

export type LookupResult =
  | WalletLookupResult
  | TransactionLookupResult
  | TokenLookupResult
  | NftLookupResult;
