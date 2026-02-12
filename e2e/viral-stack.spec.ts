import { expect, test } from "@playwright/test";
import type { TokenLookupResult } from "../lib/helius/types";
import { computeTokenTrustScore } from "../lib/helius/trust-score";
import {
  buildSharePackOgImageUrl,
  buildTokenSharePack,
} from "../lib/helius/share-pack";
import {
  isConvexTrackingEnabled,
  trackTelemetryInConvex,
} from "../lib/meme-meta/convex-rag";

const SAMPLE_TOKEN: TokenLookupResult = {
  resultType: "token",
  id: "So11111111111111111111111111111111111111112",
  name: "Wrapped SOL",
  symbol: "SOL",
  lookupMode: "ticker",
  searchedTicker: "SOL",
  sameTickerCount: 7,
  suspiciousTickerCount: 3,
  sameTickerImageCount: 4,
  imageUris: ["https://cdn.example/sol.png"],
  sameTickerTokens: [
    {
      symbol: "SOL",
      name: "Wrapped SOL",
      mint: "So11111111111111111111111111111111111111112",
      pairCount: 6,
      isExactMintMatch: true,
      risk: "canonical",
      riskReasons: ["Exact mint match"],
      liquidityUsd: 650000,
      volume24hUsd: 1200000,
      fdvUsd: 85000000,
      url: "https://dexscreener.com/solana/solpair",
    },
    {
      symbol: "SOL",
      name: "Fake SOL",
      mint: "FakeMint111111111111111111111111111111111111",
      pairCount: 1,
      isExactMintMatch: false,
      risk: "high",
      riskReasons: ["Very low liquidity", "Recently created pair"],
      liquidityUsd: 700,
      volume24hUsd: 150,
      fdvUsd: 1500000,
      url: "https://dexscreener.com/solana/fakesol",
    },
  ],
};

test.describe("Viral stack primitives", () => {
  const originalConvexUrl = process.env.CONVEX_URL;

  test.afterEach(() => {
    if (originalConvexUrl == null) delete process.env.CONVEX_URL;
    else process.env.CONVEX_URL = originalConvexUrl;
  });

  test("computes trust score with reasons and hard links", () => {
    const trust = computeTokenTrustScore(SAMPLE_TOKEN);

    expect(trust.score).toBeGreaterThanOrEqual(0);
    expect(trust.score).toBeLessThanOrEqual(100);
    expect(["A", "B", "C", "D", "F"]).toContain(trust.grade);
    expect(trust.reasons.length).toBeGreaterThan(0);
    expect(trust.hardLinks.mint).toContain("explorer.solana.com/address/");
    expect(trust.hardLinks.pair).toContain("dexscreener.com");
  });

  test("builds social share pack with image card and hype timeline", () => {
    const trust = computeTokenTrustScore(SAMPLE_TOKEN);
    const pack = buildTokenSharePack(SAMPLE_TOKEN, trust);

    expect(pack.summary).toContain("SOL");
    expect(pack.thread.length).toBeGreaterThan(2);
    expect(pack.xIntentUrl).toContain("x.com/intent/tweet");
    expect(pack.farcasterIntentUrl).toContain("warpcast.com");
    expect(pack.imageCard.bullets.length).toBeGreaterThan(2);
    expect(pack.hypeVideo.timeline.composition?.width).toBe(1080);
    expect(pack.hypeVideo.timeline.composition?.height).toBe(1920);
    expect(pack.hypeVideo.timeline.clips?.length ?? 0).toBeGreaterThan(0);

    const ogUrl = buildSharePackOgImageUrl(
      "https://example.com",
      SAMPLE_TOKEN,
      trust,
      pack.summary
    );
    expect(ogUrl).toContain("/api/share/og-image?");
    expect(ogUrl).toContain("symbol=SOL");
    expect(ogUrl).toContain("score=");
  });

  test("telemetry tracking is safely skipped when convex is not configured", async () => {
    delete process.env.CONVEX_URL;
    expect(isConvexTrackingEnabled()).toBeFalsy();
    const stored = await trackTelemetryInConvex({
      event: `scan_token_${Date.now()}`,
      page: "/helius",
      userId: "anon",
    });
    expect(stored).toBeFalsy();
  });
});
