import { test, expect } from "@playwright/test";
import { classifyQuery, extractSolanaAddress } from "../lib/query-classifier";

const SAMPLE_SOL_ADDRESS = "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY";

test.describe("Generate query classifier", () => {
  test("routes pump-related prompts to pump", () => {
    expect(classifyQuery("show me new pump.fun tokens")).toBe("pump");
    expect(classifyQuery("bonk.fun migration dashboard")).toBe("pump");
    expect(classifyQuery("pumpswap flow and bonding curve updates")).toBe("pump");
  });

  test("keeps bitcoin price prompts on market route", () => {
    expect(classifyQuery("bitcoin price")).toBe("market");
    expect(classifyQuery("btc dominance and market cap")).toBe("market");
    expect(classifyQuery("BTC")).toBe("market");
  });

  test("routes similar-ticker and standalone meme ticker prompts to token route", () => {
    expect(classifyQuery("BONK")).toBe("token");
    expect(classifyQuery("$BONK")).toBe("token");
    expect(classifyQuery("search for $LUNCH tokens")).toBe("token");
    expect(classifyQuery("show similar ticker tokens for bonk")).toBe("token");
    expect(classifyQuery("is this ticker fake bonk")).toBe("token");
    expect(classifyQuery("new pump fun token BONK, is it a copy?")).toBe("token");
  });

  test("distinguishes wallet vs whale by intent keywords", () => {
    expect(classifyQuery(`analyze whale strategy for ${SAMPLE_SOL_ADDRESS}`)).toBe("whale");
    expect(classifyQuery(`lookup wallet ${SAMPLE_SOL_ADDRESS}`)).toBe("wallet");
  });

  test("separates prediction and arbitrage intents", () => {
    expect(classifyQuery("find arbitrage between polymarket and manifold")).toBe("arbitrage");
    expect(classifyQuery("prediction market odds for election")).toBe("prediction");
  });

  test("extracts Solana address from mixed prompts", () => {
    expect(
      extractSolanaAddress(`Please deep dive wallet ${SAMPLE_SOL_ADDRESS} now`)
    ).toBe(SAMPLE_SOL_ADDRESS);
    expect(extractSolanaAddress("no address here")).toBeNull();
  });
});
