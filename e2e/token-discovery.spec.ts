import { test, expect } from "@playwright/test";
import {
  findSolanaTokensByTicker,
  isLikelyTickerQuery,
} from "../lib/token-discovery/dexscreener";

const MINT_CANONICAL = "So11111111111111111111111111111111111111112";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test.describe("Token ticker discovery", () => {
  const originalFetch = global.fetch;

  test.afterEach(() => {
    global.fetch = originalFetch;
  });

  test("validates ticker query shape", () => {
    expect(isLikelyTickerQuery("BONK")).toBeTruthy();
    expect(isLikelyTickerQuery("bonk_v2")).toBeTruthy();
    expect(isLikelyTickerQuery(MINT_CANONICAL)).toBeFalsy();
    expect(isLikelyTickerQuery("")).toBeFalsy();
  });

  test("groups same ticker by mint and flags suspicious matches", async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/latest/dex/search?q=BONK")) {
        return jsonResponse({
          pairs: [
            {
              chainId: "solana",
              dexId: "raydium",
              baseToken: { address: MINT_CANONICAL, symbol: "BONK", name: "Bonk" },
              pairAddress: "PairCanonical",
              liquidity: { usd: 220000 },
              volume: { h24: 150000 },
              fdv: 50000000,
              pairCreatedAt: Date.now() - 1000 * 60 * 60 * 24 * 300,
              url: "https://dexscreener.com/solana/paircanonical",
              info: {
                imageUrl: "https://cdn.example/canonical.png",
              },
            },
            {
              chainId: "solana",
              dexId: "raydium",
              baseToken: { address: "FakeMint1111111111111111111111111111111111111", symbol: "BONK", name: "BONK NEW" },
              pairAddress: "PairFakeA1",
              liquidity: { usd: 900 },
              volume: { h24: 120 },
              fdv: 4000000,
              pairCreatedAt: Date.now() - 1000 * 60 * 60 * 3,
              url: "https://dexscreener.com/solana/pairfakea1",
              info: {
                imageUrl: "https://cdn.example/fake-a1.png",
                header: "https://cdn.example/fake-a1-header.png",
              },
            },
            {
              chainId: "solana",
              dexId: "orca",
              baseToken: { address: "FakeMint1111111111111111111111111111111111111", symbol: "BONK", name: "BONK NEW" },
              pairAddress: "PairFakeA2",
              liquidity: { usd: 500 },
              volume: { h24: 80 },
              fdv: 3000000,
              pairCreatedAt: Date.now() - 1000 * 60 * 60 * 5,
              url: "https://dexscreener.com/solana/pairfakea2",
              info: {
                openGraph: "https://cdn.example/fake-a2-og.png",
              },
            },
            {
              chainId: "solana",
              dexId: "orca",
              baseToken: { address: "FakeMint2222222222222222222222222222222222222", symbol: "BONK", name: "BONK ALT" },
              pairAddress: "PairFakeB",
              liquidity: { usd: 30000 },
              volume: { h24: 2500 },
              fdv: 9000000,
              pairCreatedAt: Date.now() - 1000 * 60 * 60 * 36,
              url: "https://dexscreener.com/solana/pairfakeb",
            },
            {
              chainId: "ethereum",
              dexId: "uniswap",
              baseToken: { address: "0xabc", symbol: "BONK", name: "BONK ETH" },
              pairAddress: "PairEth",
              liquidity: { usd: 999999 },
              volume: { h24: 999999 },
            },
          ],
        });
      }
      return jsonResponse({ pairs: [] });
    }) as typeof fetch;

    const result = await findSolanaTokensByTicker({
      query: "bonk",
    });

    expect(result.mode).toBe("ticker");
    expect(result.ticker).toBe("BONK");
    expect(result.matches).toHaveLength(3);
    expect(result.matches.some((m) => m.mint === MINT_CANONICAL)).toBeTruthy();

    const risky = result.matches.find((m) => m.mint.includes("FakeMint111"));
    expect(risky).toBeDefined();
    expect(risky?.risk === "high" || risky?.risk === "medium").toBeTruthy();
    expect(risky?.pairCount).toBe(2);
    expect(risky?.imageUri).toBe("https://cdn.example/fake-a1.png");
    expect(risky?.imageUris).toEqual([
      "https://cdn.example/fake-a1.png",
      "https://cdn.example/fake-a1-header.png",
      "https://cdn.example/fake-a2-og.png",
    ]);
    const canonical = result.matches.find((m) => m.mint === MINT_CANONICAL);
    expect(canonical?.imageUri).toBe("https://cdn.example/canonical.png");
  });

  test("mint mode derives ticker from direct mint pairs when needed", async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/latest/dex/tokens/${MINT_CANONICAL}`)) {
        return jsonResponse({
          pairs: [
            {
              chainId: "solana",
              dexId: "raydium",
              baseToken: { address: MINT_CANONICAL, symbol: "BONK", name: "Bonk" },
              pairAddress: "PairCanonical",
              liquidity: { usd: 100000 },
              volume: { h24: 45000 },
              pairCreatedAt: Date.now() - 1000 * 60 * 60 * 24 * 10,
              info: { imageUrl: "https://cdn.example/direct-bonk.png" },
            },
          ],
        });
      }
      if (url.includes("/latest/dex/search?q=BONK")) {
        return jsonResponse({
          pairs: [
            {
              chainId: "solana",
              dexId: "raydium",
              baseToken: { address: MINT_CANONICAL, symbol: "BONK", name: "Bonk" },
              pairAddress: "PairCanonical",
              liquidity: { usd: 100000 },
              volume: { h24: 45000 },
              info: { imageUrl: "https://cdn.example/search-bonk.png" },
            },
          ],
        });
      }
      return jsonResponse({ pairs: [] });
    }) as typeof fetch;

    const result = await findSolanaTokensByTicker({
      query: MINT_CANONICAL,
    });

    expect(result.mode).toBe("mint");
    expect(result.ticker).toBe("BONK");
    expect(result.canonicalMint).toBe(MINT_CANONICAL);
    expect(result.matches[0]?.isExactMintMatch).toBeTruthy();
    expect(result.matches[0]?.risk).toBe("canonical");
    expect(result.matches[0]?.imageUri).toBe("https://cdn.example/search-bonk.png");
  });
});
