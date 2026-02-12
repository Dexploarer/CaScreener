import { expect, test } from "@playwright/test";

type JsonPatchLike = {
  op: string;
  path: string;
  value?: unknown;
};

type AGUIEventLike = {
  type: string;
  [key: string]: unknown;
};

function parseJsonlPatches(jsonl: string): JsonPatchLike[] {
  return jsonl
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof (parsed as Record<string, unknown>).op === "string" &&
          typeof (parsed as Record<string, unknown>).path === "string"
        ) {
          return [parsed as JsonPatchLike];
        }
      } catch {
        // skip invalid lines
      }
      return [];
    });
}

function getElementKey(path: string): string | null {
  if (!path.startsWith("/elements/")) return null;
  const key = path.slice("/elements/".length).split("/")[0]?.trim();
  return key || null;
}

function parseAguiEvents(ndjson: string): AGUIEventLike[] {
  return ndjson
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof (parsed as Record<string, unknown>).type === "string"
        ) {
          return [parsed as AGUIEventLike];
        }
      } catch {
        // skip invalid lines
      }
      return [];
    });
}

async function readGenerateStream(prompt: string): Promise<{
  text: string;
  chunkCount: number;
  chunkWindowMs: number;
}> {
  const res = await fetch("http://localhost:3000/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  expect(res.ok).toBeTruthy();
  const reader = res.body?.getReader();
  expect(reader).toBeTruthy();

  const decoder = new TextDecoder();
  let text = "";
  let chunkCount = 0;
  let firstChunkAt = 0;
  let lastChunkAt = 0;

  while (true) {
    const { done, value } = await reader!.read();
    if (done) break;
    const now = Date.now();
    if (firstChunkAt === 0) firstChunkAt = now;
    lastChunkAt = now;
    chunkCount += 1;
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();

  return {
    text,
    chunkCount,
    chunkWindowMs: Math.max(0, lastChunkAt - firstChunkAt),
  };
}

async function readSpecStreamFromEndpoint(
  endpoint: string,
  body: Record<string, unknown>
): Promise<{ text: string; chunkCount: number; chunkWindowMs: number }> {
  const res = await fetch(`http://localhost:3000${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  expect(res.ok).toBeTruthy();
  const reader = res.body?.getReader();
  expect(reader).toBeTruthy();

  const decoder = new TextDecoder();
  let text = "";
  let chunkCount = 0;
  let firstChunkAt = 0;
  let lastChunkAt = 0;

  while (true) {
    const { done, value } = await reader!.read();
    if (done) break;
    const now = Date.now();
    if (firstChunkAt === 0) firstChunkAt = now;
    lastChunkAt = now;
    chunkCount += 1;
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return {
    text,
    chunkCount,
    chunkWindowMs: Math.max(0, lastChunkAt - firstChunkAt),
  };
}

async function readAgentEventStream(prompt: string): Promise<{
  events: AGUIEventLike[];
  patchText: string;
  chunkCount: number;
  chunkWindowMs: number;
}> {
  const res = await fetch("http://localhost:3000/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  expect(res.ok).toBeTruthy();
  const reader = res.body?.getReader();
  expect(reader).toBeTruthy();

  const decoder = new TextDecoder();
  let text = "";
  let chunkCount = 0;
  let firstChunkAt = 0;
  let lastChunkAt = 0;

  while (true) {
    const { done, value } = await reader!.read();
    if (done) break;
    const now = Date.now();
    if (firstChunkAt === 0) firstChunkAt = now;
    lastChunkAt = now;
    chunkCount += 1;
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  const events = parseAguiEvents(text);
  const patchText = events
    .filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
    .map((event) => (typeof event.delta === "string" ? event.delta : ""))
    .join("");

  return {
    events,
    patchText,
    chunkCount,
    chunkWindowMs: Math.max(0, lastChunkAt - firstChunkAt),
  };
}

test.describe("SpecStream guardrails", () => {
  test.setTimeout(90_000);

  test("streamed /api/generate patches keep /root mapped to a real element key", async () => {
    const { text } = await readGenerateStream("bitcoin market overview");
    const patches = parseJsonlPatches(text);

    expect(patches.length).toBeGreaterThan(3);

    const rootPatches = patches.filter(
      (patch) => patch.path === "/root" && typeof patch.value === "string"
    );
    expect(rootPatches.length).toBeGreaterThan(0);

    const finalRoot = rootPatches[rootPatches.length - 1]!.value as string;
    const elementKeys = new Set(
      patches.map((patch) => getElementKey(patch.path)).filter((v): v is string => !!v)
    );

    expect(elementKeys.size).toBeGreaterThan(0);
    expect(elementKeys.has(finalRoot)).toBeTruthy();
  });

  test("api/generate responds as a multi-chunk stream (not single-shot payload)", async () => {
    const { chunkCount, chunkWindowMs } = await readGenerateStream(
      "bitcoin market overview"
    );

    expect(chunkCount).toBeGreaterThan(1);
    expect(chunkWindowMs).toBeGreaterThanOrEqual(10);
  });

  test("api/helius/generate-dashboard returns valid SpecStream patches (filtered/fallback-safe)", async () => {
    const { text, chunkCount } = await readSpecStreamFromEndpoint(
      "/api/helius/generate-dashboard",
      {}
    );
    const patches = parseJsonlPatches(text);

    expect(chunkCount).toBeGreaterThan(0);
    expect(patches.length).toBeGreaterThan(2);
    const rootPatches = patches.filter(
      (patch) => patch.path === "/root" && typeof patch.value === "string"
    );
    expect(rootPatches.length).toBeGreaterThan(0);
  });

  test("api/predictions/generate-dashboard returns valid SpecStream patches (filtered/fallback-safe)", async () => {
    const { text, chunkCount } = await readSpecStreamFromEndpoint(
      "/api/predictions/generate-dashboard",
      {}
    );
    const patches = parseJsonlPatches(text);

    expect(chunkCount).toBeGreaterThan(0);
    expect(patches.length).toBeGreaterThan(2);
    const rootPatches = patches.filter(
      (patch) => patch.path === "/root" && typeof patch.value === "string"
    );
    expect(rootPatches.length).toBeGreaterThan(0);
  });

  test("api/agent streams AG-UI events carrying SpecStream patches only", async () => {
    const { events, patchText, chunkCount, chunkWindowMs } =
      await readAgentEventStream("bitcoin market overview");

    expect(chunkCount).toBeGreaterThan(1);
    expect(chunkWindowMs).toBeGreaterThanOrEqual(10);
    expect(events.some((event) => event.type === "RUN_STARTED")).toBeTruthy();
    expect(events.some((event) => event.type === "RUN_FINISHED")).toBeTruthy();

    const lines = patchText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    expect(lines.length).toBeGreaterThan(3);

    const invalidLines = lines.filter((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        return !(
          parsed &&
          typeof parsed === "object" &&
          typeof (parsed as Record<string, unknown>).op === "string" &&
          typeof (parsed as Record<string, unknown>).path === "string"
        );
      } catch {
        return true;
      }
    });
    expect(invalidLines).toEqual([]);

    const patches = parseJsonlPatches(patchText);
    const rootPatches = patches.filter(
      (patch) => patch.path === "/root" && typeof patch.value === "string"
    );
    expect(rootPatches.length).toBeGreaterThan(0);

    const finalRoot = rootPatches[rootPatches.length - 1]!.value as string;
    const elementKeys = new Set(
      patches.map((patch) => getElementKey(patch.path)).filter((v): v is string => !!v)
    );
    expect(elementKeys.size).toBeGreaterThan(0);
    expect(elementKeys.has(finalRoot)).toBeTruthy();
  });

  test("pump prompts route to pump dashboard (not generic market dashboard)", async () => {
    const { text } = await readGenerateStream("show me pump fun launches right now");
    const patches = parseJsonlPatches(text);
    expect(patches.length).toBeGreaterThan(3);

    const hasPumpBadge = patches.some(
      (patch) => patch.path === "/elements/pump-badge-live"
    );
    expect(hasPumpBadge).toBeTruthy();
  });

  test("slash prompt routes to pump dashboard", async () => {
    const { text } = await readGenerateStream("/");
    const patches = parseJsonlPatches(text);
    expect(patches.length).toBeGreaterThan(3);

    const hasPumpBadge = patches.some(
      (patch) => patch.path === "/elements/pump-badge-live"
    );
    const hasMarketMetric = patches.some(
      (patch) => patch.path === "/elements/gm-mcap"
    );

    expect(hasPumpBadge).toBeTruthy();
    expect(hasMarketMetric).toBeFalsy();
  });

  test("pump-style mint address routes to token intel (not wallet dashboard)", async () => {
    const { text } = await readGenerateStream(
      "DfC2mRB5SNF1eCQZPh2cGi5QhNQnm3jRNHwa5Rtkpump"
    );
    const patches = parseJsonlPatches(text);
    expect(patches.length).toBeGreaterThan(3);

    const hasTokenIntel = patches.some(
      (patch) => patch.path === "/elements/token-badges"
    );
    const hasWalletSpec = patches.some(
      (patch) => patch.path === "/elements/metrics-row"
    );

    expect(hasTokenIntel).toBeTruthy();
    expect(hasWalletSpec).toBeFalsy();
  });

  test("standalone ticker routes to token intel clone scan", async () => {
    const { text } = await readGenerateStream("BONK");
    const patches = parseJsonlPatches(text);
    expect(patches.length).toBeGreaterThan(3);

    const hasTokenIntel = patches.some(
      (patch) => patch.path === "/elements/token-badges"
    );
    const hasMarketSpec = patches.some(
      (patch) => patch.path === "/elements/gm-mcap"
    );

    expect(hasTokenIntel).toBeTruthy();
    expect(hasMarketSpec).toBeFalsy();
  });

  test("inline $ticker search routes to token intel clone scan", async () => {
    const { text } = await readGenerateStream("search for $LUNCH tokens");
    const patches = parseJsonlPatches(text);
    expect(patches.length).toBeGreaterThan(3);

    const hasTokenIntel = patches.some(
      (patch) => patch.path === "/elements/token-badges"
    );
    const hasFallback = patches.some(
      (patch) => patch.path === "/elements/fallback-card"
    );

    expect(hasTokenIntel).toBeTruthy();
    expect(hasFallback).toBeFalsy();
  });

  test("launch+copy prompts route to token intel clone scan", async () => {
    const { text } = await readGenerateStream(
      "new pump fun token BONK, is it a copy?"
    );
    const patches = parseJsonlPatches(text);
    expect(patches.length).toBeGreaterThan(3);

    const hasTokenIntel = patches.some(
      (patch) => patch.path === "/elements/token-badges"
    );
    const hasPumpOverview = patches.some(
      (patch) => patch.path === "/elements/pump-badge-live"
    );

    expect(hasTokenIntel).toBeTruthy();
    expect(hasPumpOverview).toBeFalsy();
  });
});
