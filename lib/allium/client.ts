/**
 * Allium blockchain data platform client.
 * Enriches wallet/address data using Allium Realtime APIs.
 * Docs: https://docs.allium.so/
 * Sign up: https://app.allium.so/join
 */

const DEFAULT_BASE = "https://api.allium.so";

export type AlliumEnrichment = {
  address: string;
  /** Total transaction count across chains (when available) */
  totalTxCount?: number;
  /** First seen timestamp ISO string */
  firstSeen?: string;
  /** Last activity timestamp ISO string */
  lastActive?: string;
  /** Chain IDs this address has activity on */
  chains?: string[];
  /** Optional labels or tags from Allium */
  labels?: string[];
  /** Optional extra stats for UI */
  stats?: Record<string, string | number>;
};

function getConfig(): { base: string; apiKey: string } | null {
  const apiKey = process.env.ALLIUM_API_KEY?.trim();
  if (!apiKey) return null;
  const base = (process.env.ALLIUM_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
  return { base, apiKey };
}

/**
 * Fetch enrichment for a given address.
 * Returns null if Allium is not configured or the request fails.
 */
export async function getAddressEnrichment(address: string): Promise<AlliumEnrichment | null> {
  const config = getConfig();
  if (!config) return null;

  const url = `${config.base}/v1/realtime/addresses/${encodeURIComponent(address)}/summary`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 404) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (data && typeof data === "object" && "address" in data) {
      return data as AlliumEnrichment;
    }
    return {
      address,
      totalTxCount: (data as { totalTxCount?: number })?.totalTxCount,
      firstSeen: (data as { firstSeen?: string })?.firstSeen,
      lastActive: (data as { lastActive?: string })?.lastActive,
      chains: (data as { chains?: string[] })?.chains,
      labels: (data as { labels?: string[] })?.labels,
      stats: (data as { stats?: Record<string, string | number> })?.stats,
    };
  } catch {
    return null;
  }
}

/**
 * Check if Allium is configured (for UI hints).
 */
export function isAlliumConfigured(): boolean {
  return Boolean(process.env.ALLIUM_API_KEY?.trim());
}

/** Single wallet transaction from Allium (Solana supported). */
export type AlliumWalletTransaction = {
  id?: string;
  hash?: string;
  block_timestamp?: string;
  fee?: { amount?: number; amount_str?: string };
  labels?: string[];
  from_address?: string;
  to_address?: string;
  asset_transfers?: unknown[];
  activities?: unknown[];
};

/**
 * Fetch wallet transactions from Allium (supports Solana).
 * Optionally filter by transaction_hash. Returns items array or null on failure.
 * Docs: https://docs.allium.so/api/developer/wallets/transactions
 */
export async function getWalletTransactions(
  chain: "solana" | "ethereum",
  address: string,
  options: { transactionHash?: string; limit?: number } = {}
): Promise<{ items: AlliumWalletTransaction[]; cursor?: string | null } | null> {
  const config = getConfig();
  if (!config) return null;

  const url = new URL(`${config.base.replace(/\/$/, "")}/api/v1/developer/wallet/transactions`);
  if (options.transactionHash) url.searchParams.set("transaction_hash", options.transactionHash);
  if (options.limit != null) url.searchParams.set("limit", String(options.limit));

  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": config.apiKey,
      },
      body: JSON.stringify([{ chain, address }]),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 401 || res.status === 404 || !res.ok) return null;
    const data = (await res.json()) as { items?: AlliumWalletTransaction[]; cursor?: string | null };
    return {
      items: Array.isArray(data.items) ? data.items : [],
      cursor: data.cursor ?? null,
    };
  } catch {
    return null;
  }
}
