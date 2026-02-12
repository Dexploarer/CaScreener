/**
 * Helius RPC client for Solana wallet analytics.
 * Docs: https://www.helius.dev/docs/api-reference
 * Auth: https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
 * Enhanced Transactions: https://api-mainnet.helius-rpc.com/v0/...
 */

const MAINNET_RPC = "https://mainnet.helius-rpc.com";
const MAINNET_API = "https://api-mainnet.helius-rpc.com";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: unknown[] | Record<string, unknown>;
};

function getRpcUrl(apiKey: string): string {
  return `${MAINNET_RPC}/?api-key=${encodeURIComponent(apiKey)}`;
}

async function rpc<T>(apiKey: string, method: string, params: unknown[] | Record<string, unknown>): Promise<T> {
  const body: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: "1",
    method,
    params,
  };
  const res = await fetch(getRpcUrl(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Helius RPC ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { result?: T; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  return data.result as T;
}

/** SOL balance in lamports. Result: { context: { slot }, value: number } */
export async function getBalance(apiKey: string, address: string): Promise<number> {
  const result = await rpc<{ value: number }>(apiKey, "getBalance", [address]);
  return result?.value ?? 0;
}

/** Recent transactions for address. Returns { data: Array<{ signature, slot, blockTime, err, confirmationStatus }>, paginationToken? } */
export async function getTransactionsForAddress(
  apiKey: string,
  address: string,
  options: { limit?: number; transactionDetails?: "signatures" | "full"; sortOrder?: "asc" | "desc" } = {}
): Promise<{ data: Array<{ signature: string; slot: number; blockTime: number | null; err: unknown; confirmationStatus?: string }>; paginationToken?: string }> {
  const params = [
    address,
    {
      limit: options.limit ?? 20,
      transactionDetails: options.transactionDetails ?? "signatures",
      sortOrder: options.sortOrder ?? "desc",
    },
  ];
  const result = await rpc<{ data: unknown[]; paginationToken?: string }>(
    apiKey,
    "getTransactionsForAddress",
    params
  );
  return {
    data: (result?.data ?? []) as Array<{
      signature: string;
      slot: number;
      blockTime: number | null;
      err: unknown;
      confirmationStatus?: string;
    }>,
    paginationToken: result?.paginationToken,
  };
}

/** SPL token accounts for owner. Returns { token_accounts: Array<{ address, mint, owner, amount, ... }>, total, cursor? } */
export async function getTokenAccounts(
  apiKey: string,
  owner: string,
  options: { limit?: number; cursor?: string } = {}
): Promise<{
  token_accounts: Array<{
    address: string;
    mint: string;
    owner: string;
    amount: number;
    frozen?: boolean;
    delegated_amount?: number;
  }>;
  total: number;
  cursor?: string;
}> {
  const params: Record<string, unknown> = { owner };
  if (options.limit != null) params.limit = options.limit;
  if (options.cursor != null) params.cursor = options.cursor;
  const result = await rpc<{
    token_accounts: unknown[];
    total: number;
    cursor?: string;
  }>(apiKey, "getTokenAccounts", params);
  return {
    token_accounts: (result?.token_accounts ?? []) as Array<{
      address: string;
      mint: string;
      owner: string;
      amount: number;
      frozen?: boolean;
      delegated_amount?: number;
    }>,
    total: result?.total ?? 0,
    cursor: result?.cursor,
  };
}

/** NFTs and fungible assets by owner. Returns { items: Array<{ id, content, interface, ... }>, total } */
export async function getAssetsByOwner(
  apiKey: string,
  ownerAddress: string,
  options: { limit?: number; page?: number } = {}
): Promise<{ items: Array<{ id: string; interface?: string; content?: { metadata?: { name?: string; symbol?: string }; files?: Array<{ uri: string }> } }>; total: number }> {
  const params: Record<string, unknown> = { ownerAddress };
  if (options.limit != null) params.limit = options.limit;
  if (options.page != null) params.page = options.page;
  const result = await rpc<{ items: unknown[]; total: number }>(apiKey, "getAssetsByOwner", params);
  return {
    items: (result?.items ?? []) as Array<{
      id: string;
      interface?: string;
      content?: { metadata?: { name?: string; symbol?: string }; files?: Array<{ uri: string }> };
    }>,
    total: result?.total ?? 0,
  };
}

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** Enhanced Transactions REST API: human-readable descriptions. GET .../v0/addresses/{address}/transactions */
export type EnhancedTransaction = {
  signature: string;
  description?: string;
  type?: string;
  source?: string;
  fee?: number;
  feePayer?: string;
  slot?: number;
  timestamp?: number;
  nativeTransfers?: Array<{ fromUserAccount: string; toUserAccount: string; amount: number }>;
  tokenTransfers?: Array<unknown>;
};

export async function getEnhancedTransactionsByAddress(
  apiKey: string,
  address: string,
  options: { limit?: number; before?: string } = {}
): Promise<EnhancedTransaction[]> {
  const url = new URL(`${MAINNET_API}/v0/addresses/${address}/transactions`);
  url.searchParams.set("api-key", apiKey);
  if (options.limit != null) url.searchParams.set("limit", String(options.limit));
  if (options.before) url.searchParams.set("before", options.before);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Helius Enhanced API ${res.status}: ${text}`);
  }
  const data = (await res.json()) as EnhancedTransaction[];
  return Array.isArray(data) ? data : [];
}

/** Enhanced transactions by signature(s). POST v0/transactions. Returns human-readable description/type. */
export async function getEnhancedTransactions(
  apiKey: string,
  signatures: string[]
): Promise<EnhancedTransaction[]> {
  if (signatures.length === 0) return [];
  const url = `${MAINNET_API}/v0/transactions?api-key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: signatures }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Helius Enhanced API ${res.status}: ${text}`);
  }
  const data = (await res.json()) as EnhancedTransaction[];
  return Array.isArray(data) ? data : [];
}

/** DAS getAsset for token metadata (symbol, decimals, name) by mint/asset id. */
export async function getAsset(
  apiKey: string,
  assetId: string
): Promise<{
  id: string;
  content?: { metadata?: { name?: string; symbol?: string; decimals?: number }; files?: Array<{ uri: string }> };
  interface?: string;
} | null> {
  const result = await rpc<unknown>(apiKey, "getAsset", { id: assetId });
  if (result == null) return null;
  const r = result as { id: string; content?: { metadata?: { name?: string; symbol?: string; decimals?: number }; files?: Array<{ uri: string }> }; interface?: string };
  return r;
}

/** RPC getTransaction by signature. Returns slot, blockTime, fee, and fee payer when available. */
export type TransactionDetails = {
  signature: string;
  slot: number;
  blockTime: number | null;
  fee: number | null;
  feePayer: string | null;
  err: unknown;
  meta?: { err?: unknown };
};

export async function getTransaction(
  apiKey: string,
  signature: string
): Promise<TransactionDetails | null> {
  const result = await rpc<{
    slot: number;
    blockTime: number | null;
    meta?: { fee?: number; err?: unknown };
    transaction?: { message?: { accountKeys?: Array<{ pubkey?: string }> } };
  } | null>(apiKey, "getTransaction", [
    signature,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
  ]);
  if (result == null) return null;
  const fee = result.meta?.fee ?? null;
  const accountKeys = result.transaction?.message?.accountKeys ?? [];
  const feePayer = accountKeys[0]?.pubkey ?? null;
  return {
    signature,
    slot: result.slot ?? 0,
    blockTime: result.blockTime ?? null,
    fee,
    feePayer,
    err: result.meta?.err ?? null,
    meta: result.meta,
  };
}
