import { expect, test } from "@playwright/test";
import type { TokenLookupResult } from "../lib/helius/types";
import {
  buildMetaTagsForToken,
  buildNarrativeForTokenMeta,
  computeRiskBand,
  searchTokenNarrativesInConvex,
  trackTokenMetaInConvex,
} from "../lib/meme-meta/convex-rag";

const SAMPLE_TOKEN: TokenLookupResult = {
  resultType: "token",
  id: "So11111111111111111111111111111111111111112",
  name: "Wrapped SOL",
  symbol: "sol",
  lookupMode: "ticker",
  searchedTicker: "SOL",
  sameTickerCount: 6,
  suspiciousTickerCount: 3,
  sameTickerImageCount: 4,
  imageUris: ["https://cdn.example/sol.png"],
  sameTickerTokens: [
    {
      symbol: "SOL",
      name: "Wrapped SOL",
      mint: "So11111111111111111111111111111111111111112",
      pairCount: 5,
      isExactMintMatch: true,
      risk: "canonical",
      riskReasons: ["Exact mint match"],
    },
    {
      symbol: "SOL",
      name: "Fake SOL",
      mint: "FakeMint111111111111111111111111111111111111",
      pairCount: 1,
      isExactMintMatch: false,
      risk: "high",
      riskReasons: ["Very low liquidity", "Recently created pair"],
      liquidityUsd: 500,
      volume24hUsd: 200,
    },
  ],
};

test.describe("Convex meme meta tracker", () => {
  const originalFetch = global.fetch;
  const originalConvexUrl = process.env.CONVEX_URL;
  const originalConvexKey = process.env.CONVEX_DEPLOY_KEY;
  const originalNamespace = process.env.CONVEX_MEME_NAMESPACE;

  test.afterEach(() => {
    global.fetch = originalFetch;
    if (originalConvexUrl == null) delete process.env.CONVEX_URL;
    else process.env.CONVEX_URL = originalConvexUrl;
    if (originalConvexKey == null) delete process.env.CONVEX_DEPLOY_KEY;
    else process.env.CONVEX_DEPLOY_KEY = originalConvexKey;
    if (originalNamespace == null) delete process.env.CONVEX_MEME_NAMESPACE;
    else process.env.CONVEX_MEME_NAMESPACE = originalNamespace;
  });

  test("builds narrative and tags for meme token tracking", () => {
    const narrative = buildNarrativeForTokenMeta(SAMPLE_TOKEN);
    expect(narrative).toContain("Token: SOL");
    expect(narrative).toContain("Suspicious matches");

    const tags = buildMetaTagsForToken(SAMPLE_TOKEN);
    expect(tags).toContain("memecoin");
    expect(tags).toContain("clone-risk");
    expect(computeRiskBand(SAMPLE_TOKEN)).toBe("high");
  });

  test("skips tracking when CONVEX_URL is not configured", async () => {
    delete process.env.CONVEX_URL;
    const tracked = await trackTokenMetaInConvex(SAMPLE_TOKEN);
    expect(tracked).toBeFalsy();
  });

  test("tracks and searches token narratives through Convex HTTP API", async () => {
    process.env.CONVEX_URL = "https://example.convex.cloud";
    process.env.CONVEX_DEPLOY_KEY = "dev:track-test";
    process.env.CONVEX_MEME_NAMESPACE = "solana-memes-test";

    const requests: Array<{ url: string; body: string; auth?: string | null }> = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        body: String(init?.body ?? ""),
        auth:
          init?.headers && !Array.isArray(init.headers)
            ? (init.headers as Record<string, string>).Authorization
            : null,
      });
      if (url.endsWith("/api/action")) {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { path?: string };
        if (payload.path === "memeMetaAgent:ingestTokenMeta") {
          return new Response(
            JSON.stringify({
              status: "success",
              value: { tracked: true, namespace: "solana-memes-test" },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (payload.path === "memeMetaAgent:searchTokenNarratives") {
          return new Response(
            JSON.stringify({
              status: "success",
              value: {
                namespace: "solana-memes-test",
                text: "RAG context",
                resultCount: 1,
                results: [{ score: 0.81 }],
                entries: [{ title: "SOL clone narrative" }],
                usage: { tokens: 10 },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
      }
      return new Response(
        JSON.stringify({ status: "error", errorMessage: "unknown" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;

    const tracked = await trackTokenMetaInConvex(SAMPLE_TOKEN);
    expect(tracked).toBeTruthy();
    const search = await searchTokenNarrativesInConvex({
      query: "what is the SOL meta narrative?",
      symbol: "sol",
      limit: 5,
    });
    expect(search.resultCount).toBe(1);
    expect(search.namespace).toBe("solana-memes-test");

    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe("https://example.convex.cloud/api/action");
    expect(requests[0].auth).toBe("Convex dev:track-test");
    const firstBody = JSON.parse(requests[0].body) as { path: string; args: { mint: string; symbol: string } };
    expect(firstBody.path).toBe("memeMetaAgent:ingestTokenMeta");
    expect(firstBody.args.mint).toBe(SAMPLE_TOKEN.id);
    expect(firstBody.args.symbol).toBe("SOL");
    const secondBody = JSON.parse(requests[1].body) as { path: string };
    expect(secondBody.path).toBe("memeMetaAgent:searchTokenNarratives");
  });
});
