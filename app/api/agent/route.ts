import { buildSharePackOgImageUrl, buildTokenSharePack } from "@/lib/helius/share-pack";
import { computeTokenTrustScore } from "@/lib/helius/trust-score";
import type { TokenLookupResult } from "@/lib/helius/types";
import { extractSolanaAddress } from "@/lib/query-classifier";

export const maxDuration = 60;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const STREAM_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

const SPECSTREAM_ERROR_FALLBACK = [
  '{"op":"add","path":"/root","value":"error-card"}',
  '{"op":"add","path":"/elements/error-card","value":{"type":"Card","props":{"title":"Agent Stream Error","description":"Could not stream from /api/generate"},"children":["error-text"]}}',
  '{"op":"add","path":"/elements/error-text","value":{"type":"Text","props":{"content":"Retry your request. The agent returns SpecStream JSONL only."},"children":[]}}',
].join("\n");

type AgentMediaBundle = {
  id: string;
  query: string;
  tokenId: string;
  tokenSymbol?: string;
  tokenName?: string;
  token: TokenLookupResult;
  imageUrls: string[];
  ogImageUrl: string;
  shareVideoEndpoint: string;
  sameTickerCount: number;
  suspiciousTickerCount: number;
  trustScore: number;
  trustGrade: string;
  generatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isTokenLookupResult(value: unknown): value is TokenLookupResult {
  if (!isRecord(value)) return false;
  return value.resultType === "token" && typeof value.id === "string";
}

function dedupeUrls(candidates: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of candidates) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function extractTickerHint(prompt: string): string | null {
  const explicit = prompt.match(
    /\b(?:ticker|symbol|token)\s*(?:is|=|:)?\s*\$?([a-zA-Z0-9]{2,12})\b/i
  );
  if (explicit?.[1]) return explicit[1].toUpperCase();

  const dollar = prompt.match(/\$([A-Za-z][A-Za-z0-9]{1,11})\b/);
  if (dollar?.[1]) return dollar[1].toUpperCase();

  const single = prompt.trim();
  if (/^[A-Za-z][A-Za-z0-9]{1,11}$/.test(single)) {
    return single.toUpperCase();
  }

  return null;
}

function extractTokenLookupHint(prompt: string): string | null {
  const mint = extractSolanaAddress(prompt);
  if (mint) return mint;
  return extractTickerHint(prompt);
}

async function fetchTokenLookup(
  origin: string,
  query: string
): Promise<TokenLookupResult | null> {
  const res = await fetch(`${origin}/api/helius/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "token", id: query }),
    cache: "no-store",
  }).catch(() => null);

  if (!res || !res.ok) return null;
  const payload = await res.json().catch(() => null);
  if (!isTokenLookupResult(payload)) return null;
  return payload;
}

async function buildMediaBundleForPrompt(
  reqUrl: string,
  prompt: string
): Promise<AgentMediaBundle | null> {
  const query = extractTokenLookupHint(prompt);
  if (!query) return null;

  const origin = new URL(reqUrl).origin;
  const token = await fetchTokenLookup(origin, query);
  if (!token) return null;

  const trust = token.trustScore ?? computeTokenTrustScore(token);
  const sharePack = buildTokenSharePack(token, trust);
  const ogImageUrl = buildSharePackOgImageUrl(origin, token, trust, sharePack.summary);

  const imageUrls = dedupeUrls([
    ...(token.imageUris ?? []),
    token.imageUri,
    ...(token.sameTickerTokens ?? []).flatMap((t) => [t.imageUri, ...(t.imageUris ?? [])]),
  ]).slice(0, 16);

  return {
    id: `${token.id}:${Date.now()}`,
    query,
    tokenId: token.id,
    tokenSymbol: token.symbol,
    tokenName: token.name,
    token,
    imageUrls,
    ogImageUrl,
    shareVideoEndpoint: `${origin}/api/share/video`,
    sameTickerCount: token.sameTickerCount ?? 0,
    suspiciousTickerCount: token.suspiciousTickerCount ?? 0,
    trustScore: trust.score,
    trustGrade: trust.grade,
    generatedAt: new Date().toISOString(),
  };
}

function emitAGUI(
  controller: ReadableStreamDefaultController<Uint8Array>,
  events: Array<Record<string, unknown>>
) {
  for (const event of events) {
    controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitSpecStreamChunkToDeltas(chunk: string): string[] {
  if (!chunk) return [];
  const lines = chunk.split("\n");
  if (lines.length <= 1) return [chunk];

  const out: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    out.push(`${line}\n`);
  }
  return out;
}

async function pipeTextStreamToAGUI(
  textStreamBody: ReadableStream<Uint8Array> | null,
  controller: ReadableStreamDefaultController<Uint8Array>,
  preludeEvents: Array<Record<string, unknown>> = []
) {
  emitAGUI(controller, [
    { type: "RUN_STARTED", threadId: "t1", runId: "r1" },
    { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" },
  ]);

  if (preludeEvents.length > 0) {
    emitAGUI(controller, preludeEvents);
  }

  if (textStreamBody) {
    const reader = textStreamBody.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (!text) continue;

        const deltas = splitSpecStreamChunkToDeltas(text);
        for (const delta of deltas) {
          emitAGUI(controller, [
            { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta },
          ]);
          // Yield between chunks so the response is observably streamed.
          await sleep(3);
        }
      }

      const trailing = decoder.decode();
      if (trailing) {
        const deltas = splitSpecStreamChunkToDeltas(trailing);
        for (const delta of deltas) {
          emitAGUI(controller, [
            { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta },
          ]);
          await sleep(3);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  emitAGUI(controller, [
    { type: "TEXT_MESSAGE_END", messageId: "m1" },
    { type: "RUN_FINISHED" },
  ]);
  controller.close();
}

function streamAsAGUI(
  textStreamBody: ReadableStream<Uint8Array> | null,
  preludeEvents: Array<Record<string, unknown>> = []
) {
  const aguiStream = new ReadableStream({
    async start(controller) {
      await pipeTextStreamToAGUI(textStreamBody, controller, preludeEvents);
    },
  });
  return new Response(aguiStream, { headers: STREAM_HEADERS });
}

function streamErrorAsAGUI(preludeEvents: Array<Record<string, unknown>> = []) {
  const body = new ReadableStream({
    async start(controller) {
      await pipeTextStreamToAGUI(
        new ReadableStream({
          start(inner) {
            inner.enqueue(encoder.encode(SPECSTREAM_ERROR_FALLBACK));
            inner.close();
          },
        }),
        controller,
        preludeEvents
      );
    },
  });
  return new Response(body, { headers: STREAM_HEADERS });
}

export async function POST(req: Request) {
  const { prompt } = await req.json().catch(() => ({}));
  const userPrompt =
    typeof prompt === "string" ? prompt : "Give me a crypto market overview.";

  const mediaBundle = await buildMediaBundleForPrompt(req.url, userPrompt).catch(() => null);
  const preludeEvents: Array<Record<string, unknown>> = mediaBundle
    ? [{ type: "CUSTOM", name: "media_bundle", value: mediaBundle }]
    : [];

  try {
    const origin = new URL(req.url).origin;
    const generateResponse = await fetch(`${origin}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userPrompt }),
      cache: "no-store",
    });
    if (!generateResponse.ok) {
      console.error(
        "AG-UI proxy /api/generate failed with status:",
        generateResponse.status
      );
      return streamErrorAsAGUI(preludeEvents);
    }
    return streamAsAGUI(generateResponse.body, preludeEvents);
  } catch (error) {
    console.error("AG-UI proxy to /api/generate failed:", error);
    return streamErrorAsAGUI(preludeEvents);
  }
}
