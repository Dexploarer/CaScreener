/**
 * Shared wallet analytics builder for Helius + Allium.
 * Used by POST /api/helius/analytics and POST /api/helius/lookup (type: wallet).
 */

import {
  getBalance,
  getTokenAccounts,
  getAssetsByOwner,
  getEnhancedTransactionsByAddress,
  getAsset,
  LAMPORTS_PER_SOL,
} from "@/lib/helius/client";
import { getAddressEnrichment } from "@/lib/allium/client";

export type WalletAnalyticsPayload = {
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
  alliumEnrichment?: {
    totalTxCount?: number;
    firstSeen?: string;
    lastActive?: string;
    chains?: string[];
    labels?: string[];
    stats?: Record<string, string | number>;
  };
  nativeTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
    timestamp: number;
    signature: string;
  }>;
  tokenTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
    mint: string;
    timestamp: number;
    signature: string;
  }>;
};

export async function buildWalletAnalytics(
  apiKey: string,
  address: string
): Promise<WalletAnalyticsPayload> {
  const [balanceResult, tokenResult, assetsResult, enhancedTxs] = await Promise.all([
    getBalance(apiKey, address),
    getTokenAccounts(apiKey, address, { limit: 100 }),
    getAssetsByOwner(apiKey, address, { limit: 50 }).catch(() => ({ items: [], total: 0 })),
    getEnhancedTransactionsByAddress(apiKey, address, { limit: 25 }).catch(() => []),
  ]);

  const transactions = enhancedTxs.map((t) => ({
    signature: t.signature,
    slot: t.slot ?? 0,
    blockTime: t.timestamp ?? null,
    err: null,
    confirmationStatus: undefined,
    description: t.description,
    type: t.type,
  }));

  const tokenAccounts = tokenResult.token_accounts ?? [];
  const uniqueMints = [...new Set(tokenAccounts.map((a) => a.mint))].slice(0, 30);
  const mintMeta = await Promise.all(
    uniqueMints.map((mint) =>
      getAsset(apiKey, mint).then((a) => ({ mint, meta: a })).catch(() => ({ mint, meta: null }))
    )
  );
  const metaByMint = new Map<string, any>(
    mintMeta.map(({ mint, meta }) => [mint, meta?.content?.metadata])
  );

  const tokenAccountsEnriched = tokenAccounts.map((acc) => {
    const meta = metaByMint.get(acc.mint);
    return {
      ...acc,
      symbol: meta?.symbol,
      decimals: meta?.decimals,
      name: meta?.name,
    };
  });

  const nfts = (assetsResult.items ?? []).map((a) => ({
    id: a.id,
    name: a.content?.metadata?.name,
    image: a.content?.files?.[0]?.uri,
    interface: a.interface,
  }));

  const analytics: WalletAnalyticsPayload = {
    address,
    solBalance: balanceResult / LAMPORTS_PER_SOL,
    solBalanceLamports: balanceResult,
    transactions,
    transactionCount: transactions.length,
    tokenAccounts: tokenAccountsEnriched,
    tokenCount: tokenResult.total ?? 0,
    nfts,
    nftCount: assetsResult.total ?? 0,
    nativeTransfers: enhancedTxs.flatMap((t) =>
      (t.nativeTransfers ?? []).map((nt) => ({
        ...nt,
        timestamp: t.timestamp ?? 0,
        signature: t.signature,
      }))
    ),
    tokenTransfers: enhancedTxs.flatMap((t) =>
      ((t.tokenTransfers as any[]) ?? []).map((tt) => ({
        fromUserAccount: tt.fromUserAccount,
        toUserAccount: tt.toUserAccount,
        amount: tt.tokenAmount,
        mint: tt.mint,
        timestamp: t.timestamp ?? 0,
        signature: t.signature,
      }))
    ),
  };

  const allium = await getAddressEnrichment(address).catch(() => null);
  if (allium) {
    analytics.alliumEnrichment = {
      totalTxCount: allium.totalTxCount,
      firstSeen: allium.firstSeen,
      lastActive: allium.lastActive,
      chains: allium.chains,
      labels: allium.labels,
      stats: allium.stats,
    };
  }

  return analytics;
}
