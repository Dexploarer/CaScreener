import { test, expect } from "@playwright/test";
import type { PumpSnapshot } from "../lib/market-data/pumpportal";
import {
  buildPumpMediaBundle,
  buildPumpVideoPromptTemplate,
} from "../lib/media/pump-remotion";

const SAMPLE_SNAPSHOT: PumpSnapshot = {
  timestamp: "2026-02-11T00:00:00.000Z",
  newTokens: [
    {
      mint: "MintAlpha",
      name: "Alpha Launch",
      symbol: "ALPHA",
      signature: "sig-alpha",
      txType: "create",
      marketCapSol: 420,
      solAmount: 12.5,
      timestamp: 1_700_000_001,
    },
    {
      mint: "MintBeta",
      name: "Beta Launch",
      symbol: "BETA",
      signature: "sig-beta",
      txType: "create",
      marketCapSol: 95,
      solAmount: 3.2,
      timestamp: 1_700_000_002,
    },
  ],
  recentTrades: [
    {
      mint: "MintAlpha",
      name: "Alpha Launch",
      symbol: "ALPHA",
      signature: "sig-trade-buy",
      txType: "buy",
      solAmount: 9,
      timestamp: 1_700_000_010,
    },
    {
      mint: "MintAlpha",
      name: "Alpha Launch",
      symbol: "ALPHA",
      signature: "sig-trade-sell",
      txType: "sell",
      solAmount: 2.5,
      timestamp: 1_700_000_011,
    },
  ],
  migrations: [
    {
      mint: "MintGamma",
      name: "Gamma Move",
      symbol: "GAMMA",
      signature: "sig-migrate",
      bondingCurveKey: "Curve111",
      timestamp: 1_700_000_020,
    },
  ],
};

test.describe("Pump media templates", () => {
  test("builds a remotion-compatible timeline bundle", () => {
    const bundle = buildPumpMediaBundle(
      SAMPLE_SNAPSHOT,
      "Make a high-energy launch recap"
    );

    expect(bundle.timeline.composition?.width).toBe(1080);
    expect(bundle.timeline.composition?.height).toBe(1920);
    expect(bundle.timeline.composition?.fps).toBe(30);
    expect(bundle.timeline.clips?.length).toBeGreaterThanOrEqual(5);
    expect(bundle.timeline.clips?.some((clip) => clip.component === "TitleCard")).toBeTruthy();
    expect(bundle.timeline.clips?.some((clip) => clip.component === "TypingText")).toBeTruthy();

    expect(bundle.screenshotPlan).toHaveLength(5);
    expect(bundle.promptTemplates.videoScript).toContain("RECAP DATA");
    expect(bundle.recap).toContain("2 launches");
  });

  test("video prompt template includes key numbers", () => {
    const prompt = buildPumpVideoPromptTemplate(
      SAMPLE_SNAPSHOT,
      "viral clip format"
    );

    expect(prompt).toContain("FOCUS: viral clip format");
    expect(prompt).toContain("2 launches");
    expect(prompt).toContain("1 migrations");
    expect(prompt).toContain("TOP LAUNCH");
  });
});
