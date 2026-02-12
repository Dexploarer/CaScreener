const BASE_URL = "wss://pumpportal.fun/api/data";
const CACHE_TTL = 30_000;
const MAX_EVENTS_PER_BUCKET = 200;

type WsReadyState = 0 | 1 | 2 | 3;

type WsLike = {
  readyState: WsReadyState;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error", listener: () => void): void;
  addEventListener(type: "close", listener: () => void): void;
  removeEventListener(type: "open", listener: () => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "error", listener: () => void): void;
  removeEventListener(type: "close", listener: () => void): void;
};

type WsCtor = new (url: string) => WsLike;
const WS_CONNECTING = 0;
const WS_OPEN = 1;

let wsCtorPromise: Promise<WsCtor> | null = null;

async function getWebSocketCtor(): Promise<WsCtor> {
  if (typeof globalThis.WebSocket !== "undefined") {
    return globalThis.WebSocket as unknown as WsCtor;
  }
  if (!wsCtorPromise) {
    wsCtorPromise = import("undici").then((mod) => mod.WebSocket as unknown as WsCtor);
  }
  return wsCtorPromise;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function getSnapshotWindowMs(): number {
  return readPositiveIntEnv("PUMPPORTAL_SNAPSHOT_WINDOW_MS", 4_000);
}

function getTokenTradesWindowMs(): number {
  return readPositiveIntEnv("PUMPPORTAL_TOKEN_TRADES_WINDOW_MS", 3_000);
}

function getConnectionTimeoutMs(): number {
  return readPositiveIntEnv("PUMPPORTAL_CONNECTION_TIMEOUT_MS", 8_000);
}

export type PumpTokenEvent = {
  mint: string;
  name: string;
  symbol: string;
  uri?: string;
  signature: string;
  traderPublicKey?: string;
  timestamp?: number;
  // Trade fields (present on trade events)
  txType?: "buy" | "sell" | "create";
  tokenAmount?: number;
  solAmount?: number;
  newTokenBalance?: number;
  bondingCurveKey?: string;
  vTokensInBondingCurve?: number;
  vSolInBondingCurve?: number;
  marketCapSol?: number;
};

export type PumpSnapshot = {
  newTokens: PumpTokenEvent[];
  recentTrades: PumpTokenEvent[];
  migrations: PumpTokenEvent[];
  timestamp: string;
};

let snapshotCache: { data: PumpSnapshot; ts: number } | null = null;

function getPumpPortalWsUrl(): string {
  const override = process.env.PUMPPORTAL_WS_URL?.trim();
  if (override) return override;
  const apiKey = process.env.PUMPPORTAL_API_KEY;
  if (!apiKey) return BASE_URL;
  return `${BASE_URL}?api-key=${encodeURIComponent(apiKey)}`;
}

export function clearPumpSnapshotCache(): void {
  snapshotCache = null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim().length > 0) {
      const parsed = Number(v);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

async function parseWsMessage(raw: unknown): Promise<unknown> {
  let text: string;
  if (typeof raw === "string") {
    text = raw;
  } else if (typeof Blob !== "undefined" && raw instanceof Blob) {
    text = await raw.text();
  } else if (raw instanceof ArrayBuffer) {
    text = Buffer.from(raw).toString("utf8");
  } else if (ArrayBuffer.isView(raw)) {
    text = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("utf8");
  } else {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeEvent(input: unknown): { event: PumpTokenEvent; raw: Record<string, unknown> } | null {
  const raw = asRecord(input);
  if (!raw) return null;

  const looksLikeEvent = [
    "mint",
    "tokenAddress",
    "tokenMint",
    "signature",
    "txSignature",
    "txType",
    "tokenAmount",
    "solAmount",
    "marketCapSol",
    "traderPublicKey",
    "bondingCurveKey",
    "name",
    "symbol",
  ].some((key) => key in raw);
  if (!looksLikeEvent) return null;

  const mint = pickString(raw, ["mint", "tokenAddress", "tokenMint", "baseMint"]);
  if (!mint) return null;

  const signature =
    pickString(raw, ["signature", "txSignature", "txHash"]) ??
    `${mint}:${pickNumber(raw, ["timestamp"]) ?? Date.now()}`;

  const name = pickString(raw, ["name", "tokenName"]) ?? mint.slice(0, 6);
  const symbol = pickString(raw, ["symbol", "tokenSymbol"]) ?? name.slice(0, 8).toUpperCase();

  const txTypeRaw = pickString(raw, ["txType"]);
  const txType = txTypeRaw === "buy" || txTypeRaw === "sell" || txTypeRaw === "create" ? txTypeRaw : undefined;

  const event: PumpTokenEvent = {
    mint,
    name,
    symbol,
    uri: pickString(raw, ["uri"]),
    signature,
    traderPublicKey: pickString(raw, ["traderPublicKey", "trader", "user"]),
    timestamp: pickNumber(raw, ["timestamp", "blockTime"]),
    txType,
    tokenAmount: pickNumber(raw, ["tokenAmount", "amount"]),
    solAmount: pickNumber(raw, ["solAmount"]),
    newTokenBalance: pickNumber(raw, ["newTokenBalance"]),
    bondingCurveKey: pickString(raw, ["bondingCurveKey"]),
    vTokensInBondingCurve: pickNumber(raw, ["vTokensInBondingCurve"]),
    vSolInBondingCurve: pickNumber(raw, ["vSolInBondingCurve"]),
    marketCapSol: pickNumber(raw, ["marketCapSol", "marketCap"]),
  };

  return { event, raw };
}

function likelyMigration(raw: Record<string, unknown>, event: PumpTokenEvent): boolean {
  const method = typeof raw["method"] === "string" ? raw["method"].toLowerCase() : "";
  const type = typeof raw["type"] === "string" ? raw["type"].toLowerCase() : "";
  if (method.includes("migration")) return true;
  if (type.includes("migration")) return true;
  if ("poolAddress" in raw || "migration" in raw || "amm" in raw) return true;
  if (!event.txType && !!event.bondingCurveKey) return true;
  return false;
}

type CollectorConfig = {
  durationMs: number;
  subscriptions: Array<Record<string, unknown>>;
  onEvent: (event: PumpTokenEvent, raw: Record<string, unknown>) => void;
};

function collectEvents(config: CollectorConfig): Promise<void> {
  return getWebSocketCtor().then((WebSocketImpl) => new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(getPumpPortalWsUrl());
    let settled = false;
    let collectionTimer: ReturnType<typeof setTimeout> | undefined;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;

    const onOpen = () => {
      if (connectTimer) clearTimeout(connectTimer);
      for (const payload of config.subscriptions) {
        ws.send(JSON.stringify(payload));
      }
    };

    const onMessage = (evt: { data: unknown }) => {
      void (async () => {
        const parsed = await parseWsMessage(evt.data);
        const normalized = normalizeEvent(parsed);
        if (!normalized) return;
        config.onEvent(normalized.event, normalized.raw);
      })();
    };

    const onError = () => finish(new Error("PumpPortal websocket error"));
    const onClose = () => {
      if (!settled) finish();
    };

    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (collectionTimer) clearTimeout(collectionTimer);
      if (connectTimer) clearTimeout(connectTimer);
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
      if (ws.readyState === WS_CONNECTING || ws.readyState === WS_OPEN) {
        try {
          ws.close();
        } catch {
          // best effort close
        }
      }
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      resolve();
    };

    collectionTimer = setTimeout(() => finish(), config.durationMs);
    connectTimer = setTimeout(
      () => finish(new Error("PumpPortal connection timed out")),
      getConnectionTimeoutMs()
    );

    ws.addEventListener("open", onOpen);
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  }));
}

function capPush(target: PumpTokenEvent[], event: PumpTokenEvent) {
  if (target.length >= MAX_EVENTS_PER_BUCKET) return;
  target.push(event);
}

function eventKey(event: PumpTokenEvent): string {
  const signature = event.signature?.trim();
  if (signature) return signature;
  return [
    event.mint,
    event.txType ?? "unknown",
    event.timestamp ?? 0,
    event.traderPublicKey ?? "na",
  ].join(":");
}

function capPushUnique(
  target: PumpTokenEvent[],
  seen: Set<string>,
  event: PumpTokenEvent
) {
  const key = eventKey(event);
  if (seen.has(key)) return;
  seen.add(key);
  capPush(target, event);
}

export async function getPumpSnapshot(): Promise<PumpSnapshot> {
  if (snapshotCache && Date.now() - snapshotCache.ts < CACHE_TTL) {
    return snapshotCache.data;
  }

  const newTokens: PumpTokenEvent[] = [];
  const recentTrades: PumpTokenEvent[] = [];
  const migrations: PumpTokenEvent[] = [];
  const seenNewTokens = new Set<string>();
  const seenRecentTrades = new Set<string>();
  const seenMigrations = new Set<string>();
  const collectSnapshotPass = async (durationMs: number) => {
    await collectEvents({
      durationMs,
      subscriptions: [
        { method: "subscribeNewToken" },
        { method: "subscribeMigration" },
      ],
      onEvent(event, raw) {
        if (event.txType === "create") {
          capPushUnique(newTokens, seenNewTokens, event);
          return;
        }
        if (event.txType === "buy" || event.txType === "sell") {
          capPushUnique(recentTrades, seenRecentTrades, event);
          return;
        }
        if (likelyMigration(raw, event)) {
          capPushUnique(migrations, seenMigrations, event);
          return;
        }
        capPushUnique(migrations, seenMigrations, event);
      },
    });
  };

  const firstPassMs = getSnapshotWindowMs();
  await collectSnapshotPass(firstPassMs);

  // When the first pass is empty, retry once with a shorter follow-up window.
  // This reduces false "no data" impressions caused by bursty event timing.
  if (
    newTokens.length === 0 &&
    recentTrades.length === 0 &&
    migrations.length === 0
  ) {
    const retryMs = Math.max(2_000, Math.floor(firstPassMs / 2));
    await collectSnapshotPass(retryMs);
  }

  const snapshot: PumpSnapshot = {
    newTokens,
    recentTrades,
    migrations,
    timestamp: new Date().toISOString(),
  };

  snapshotCache = { data: snapshot, ts: Date.now() };
  return snapshot;
}

export async function getTokenTrades(mint: string): Promise<PumpTokenEvent[]> {
  const tokenMint = mint.trim();
  if (!tokenMint) return [];

  const mintLower = tokenMint.toLowerCase();
  const trades: PumpTokenEvent[] = [];
  const seenTrades = new Set<string>();

  await collectEvents({
    durationMs: getTokenTradesWindowMs(),
    subscriptions: [{ method: "subscribeTokenTrade", keys: [tokenMint] }],
    onEvent(event) {
      if (event.mint.toLowerCase() !== mintLower) return;
      if (event.txType !== "buy" && event.txType !== "sell" && event.txType !== "create") return;
      capPushUnique(trades, seenTrades, event);
    },
  });

  return trades.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
}

function formatMaybeSol(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M SOL`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K SOL`;
  return `${value.toFixed(2)} SOL`;
}

export function serializePumpForLLM(snapshot: PumpSnapshot): string {
  const trades = snapshot.recentTrades;
  const totalSolVolume = trades.reduce((sum, t) => sum + (t.solAmount ?? 0), 0);
  const buyCount = trades.filter((t) => t.txType === "buy").length;
  const sellCount = trades.filter((t) => t.txType === "sell").length;

  const parts: string[] = [];
  parts.push(`PumpPortal snapshot timestamp: ${snapshot.timestamp}`);
  parts.push(`New token launches: ${snapshot.newTokens.length}`);
  parts.push(`Recent trades: ${snapshot.recentTrades.length}`);
  parts.push(`Recent migrations: ${snapshot.migrations.length}`);
  parts.push(`Observed trade flow: buys=${buyCount}, sells=${sellCount}, totalVolume=${formatMaybeSol(totalSolVolume)}`);

  if (snapshot.newTokens.length > 0) {
    parts.push("\nNEW TOKEN LAUNCHES:");
    snapshot.newTokens.slice(0, 20).forEach((t) => {
      parts.push(
        `  ${t.symbol} (${t.name}) | mint=${t.mint} | mcap=${formatMaybeSol(t.marketCapSol)} | sol=${formatMaybeSol(t.solAmount)} | tx=${t.signature}`
      );
    });
  }

  if (snapshot.recentTrades.length > 0) {
    parts.push("\nRECENT TRADES:");
    snapshot.recentTrades.slice(0, 25).forEach((t) => {
      parts.push(
        `  ${t.txType ?? "trade"} ${t.symbol} | sol=${formatMaybeSol(t.solAmount)} | tokens=${t.tokenAmount?.toFixed(2) ?? "n/a"} | mcap=${formatMaybeSol(t.marketCapSol)} | trader=${t.traderPublicKey ?? "n/a"}`
      );
    });
  }

  if (snapshot.migrations.length > 0) {
    parts.push("\nRECENT MIGRATIONS:");
    snapshot.migrations.slice(0, 20).forEach((t) => {
      parts.push(`  ${t.symbol} (${t.name}) | mint=${t.mint} | curve=${t.bondingCurveKey ?? "n/a"} | tx=${t.signature}`);
    });
  }

  return parts.join("\n");
}
