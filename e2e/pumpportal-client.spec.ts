import { test, expect } from "@playwright/test";
import { WebSocketServer } from "ws";
import {
  clearPumpSnapshotCache,
  getPumpSnapshot,
  getTokenTrades,
} from "../lib/market-data/pumpportal";

function sendJson(socket: { send: (data: string) => void }, payload: Record<string, unknown>) {
  socket.send(JSON.stringify(payload));
}

function restoreEnv(name: string, value: string | undefined) {
  if (value == null) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test.describe("PumpPortal client integration", () => {
  test.describe.configure({ mode: "serial" });

  let wss: WebSocketServer | null = null;

  const originalEnv = {
    wsUrl: process.env.PUMPPORTAL_WS_URL,
    snapshotWindow: process.env.PUMPPORTAL_SNAPSHOT_WINDOW_MS,
    tradesWindow: process.env.PUMPPORTAL_TOKEN_TRADES_WINDOW_MS,
    connectTimeout: process.env.PUMPPORTAL_CONNECTION_TIMEOUT_MS,
  };

  test.beforeAll(async () => {
    wss = new WebSocketServer({ port: 0 });
    const addr = wss.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Failed to bind mock WebSocket server");
    }

    process.env.PUMPPORTAL_WS_URL = `ws://127.0.0.1:${addr.port}`;
    process.env.PUMPPORTAL_SNAPSHOT_WINDOW_MS = "200";
    process.env.PUMPPORTAL_TOKEN_TRADES_WINDOW_MS = "180";
    process.env.PUMPPORTAL_CONNECTION_TIMEOUT_MS = "1000";

    wss.on("connection", (socket) => {
      let sentSnapshotPayload = false;
      let sentTradesPayload = false;
      const methods = new Set<string>();

      socket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as { method?: string; keys?: string[] };
        const method = typeof msg.method === "string" ? msg.method : "";
        if (method) methods.add(method);

        if (
          !sentSnapshotPayload &&
          methods.has("subscribeNewToken") &&
          methods.has("subscribeMigration")
        ) {
          sentSnapshotPayload = true;

          // New token (duplicate signature sent twice; should dedupe)
          sendJson(socket, {
            mint: "MintCreate",
            name: "Create Token",
            symbol: "CRT",
            txType: "create",
            signature: "sig-create-1",
            marketCapSol: 120,
            timestamp: 1_700_000_001,
          });
          sendJson(socket, {
            mint: "MintCreate",
            name: "Create Token",
            symbol: "CRT",
            txType: "create",
            signature: "sig-create-1",
            marketCapSol: 120,
            timestamp: 1_700_000_001,
          });

          // Trade (duplicate signature sent twice; should dedupe)
          sendJson(socket, {
            mint: "MintTrade",
            name: "Trade Token",
            symbol: "TRD",
            txType: "buy",
            signature: "sig-trade-1",
            solAmount: 4.2,
            timestamp: 1_700_000_002,
          });
          sendJson(socket, {
            mint: "MintTrade",
            name: "Trade Token",
            symbol: "TRD",
            txType: "buy",
            signature: "sig-trade-1",
            solAmount: 4.2,
            timestamp: 1_700_000_002,
          });

          // Migration (no txType; tagged by method + curve key, duplicate signature)
          sendJson(socket, {
            method: "migrationEvent",
            mint: "MintMigrate",
            name: "Migration Token",
            symbol: "MIG",
            signature: "sig-migrate-1",
            bondingCurveKey: "Curve111111",
            timestamp: 1_700_000_003,
          });
          sendJson(socket, {
            method: "migrationEvent",
            mint: "MintMigrate",
            name: "Migration Token",
            symbol: "MIG",
            signature: "sig-migrate-1",
            bondingCurveKey: "Curve111111",
            timestamp: 1_700_000_003,
          });
        }

        if (!sentTradesPayload && method === "subscribeTokenTrade") {
          sentTradesPayload = true;
          const targetMint = msg.keys?.[0] ?? "MintTrade";

          sendJson(socket, {
            mint: targetMint,
            name: "Trade Token",
            symbol: "TRD",
            txType: "buy",
            signature: "sig-token-trade-1",
            solAmount: 1.2,
            timestamp: 1_700_000_010,
          });
          sendJson(socket, {
            mint: targetMint,
            name: "Trade Token",
            symbol: "TRD",
            txType: "buy",
            signature: "sig-token-trade-1",
            solAmount: 1.2,
            timestamp: 1_700_000_010,
          });
          sendJson(socket, {
            mint: targetMint,
            name: "Trade Token",
            symbol: "TRD",
            txType: "sell",
            signature: "sig-token-trade-2",
            solAmount: 0.7,
            timestamp: 1_700_000_011,
          });
          sendJson(socket, {
            mint: "AnotherMint",
            name: "Other Token",
            symbol: "OTH",
            txType: "buy",
            signature: "sig-token-trade-other",
            solAmount: 99,
            timestamp: 1_700_000_012,
          });
        }
      });
    });

  });

  test.afterAll(async () => {
    clearPumpSnapshotCache();
    if (wss) {
      await new Promise<void>((resolve, reject) => {
        wss!.close((err) => (err ? reject(err) : resolve()));
      });
      wss = null;
    }

    restoreEnv("PUMPPORTAL_WS_URL", originalEnv.wsUrl);
    restoreEnv("PUMPPORTAL_SNAPSHOT_WINDOW_MS", originalEnv.snapshotWindow);
    restoreEnv("PUMPPORTAL_TOKEN_TRADES_WINDOW_MS", originalEnv.tradesWindow);
    restoreEnv("PUMPPORTAL_CONNECTION_TIMEOUT_MS", originalEnv.connectTimeout);
  });

  test("collects snapshot buckets and de-duplicates repeated signatures", async () => {
    clearPumpSnapshotCache();
    const snapshot = await getPumpSnapshot();

    expect(snapshot.newTokens).toHaveLength(1);
    expect(snapshot.recentTrades).toHaveLength(1);
    expect(snapshot.migrations).toHaveLength(1);

    expect(snapshot.newTokens[0].signature).toBe("sig-create-1");
    expect(snapshot.recentTrades[0].signature).toBe("sig-trade-1");
    expect(snapshot.migrations[0].signature).toBe("sig-migrate-1");
  });

  test("collects token trades for a specific mint and filters duplicates", async () => {
    const trades = await getTokenTrades("MintTrade");

    expect(trades).toHaveLength(2);
    expect(trades.map((t) => t.signature)).toEqual([
      "sig-token-trade-2",
      "sig-token-trade-1",
    ]);
    expect(trades.every((t) => t.mint === "MintTrade")).toBeTruthy();
  });
});
