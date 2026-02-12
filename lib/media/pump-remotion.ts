import type { TimelineSpec } from "@json-render/remotion";
import type { PumpSnapshot, PumpTokenEvent } from "@/lib/market-data/pumpportal";

export type PumpScreenshotPlanItem = {
  id: string;
  title: string;
  purpose: string;
  frameHint: number;
  timestampHint: string;
  recommendedCaption: string;
};

export type PumpPromptTemplates = {
  videoScript: string;
  socialThread: string;
  screenshotCaptions: string;
  thumbnailHook: string;
};

export type PumpMediaBundle = {
  recap: string;
  timeline: TimelineSpec;
  screenshotPlan: PumpScreenshotPlanItem[];
  promptTemplates: PumpPromptTemplates;
};

function formatSol(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M SOL`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K SOL`;
  if (value >= 1) return `${value.toFixed(2)} SOL`;
  return `${value.toFixed(4)} SOL`;
}

function trimText(input: string, max = 48): string {
  const t = input.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 3)}...`;
}

function topLaunch(snapshot: PumpSnapshot): PumpTokenEvent | null {
  const sorted = snapshot.newTokens
    .slice()
    .sort((a, b) => (b.marketCapSol ?? 0) - (a.marketCapSol ?? 0));
  return sorted[0] ?? null;
}

function buySell(snapshot: PumpSnapshot): { buy: number; sell: number; total: number; net: number } {
  const buy = snapshot.recentTrades
    .filter((t) => t.txType === "buy")
    .reduce((sum, t) => sum + (t.solAmount ?? 0), 0);
  const sell = snapshot.recentTrades
    .filter((t) => t.txType === "sell")
    .reduce((sum, t) => sum + (t.solAmount ?? 0), 0);
  const total = buy + sell;
  return { buy, sell, total, net: buy - sell };
}

export function buildPumpRecap(snapshot: PumpSnapshot): string {
  const flow = buySell(snapshot);
  const lead = topLaunch(snapshot);
  const parts = [
    `${snapshot.newTokens.length} launches`,
    `${snapshot.migrations.length} migrations`,
    `${formatSol(flow.total)} flow`,
  ];
  if (lead) {
    parts.push(`top launch ${lead.symbol.toUpperCase()} ${formatSol(lead.marketCapSol)}`);
  }
  return parts.join(" | ");
}

export function buildPumpVideoPromptTemplate(
  snapshot: PumpSnapshot,
  userPrompt = ""
): string {
  const flow = buySell(snapshot);
  const lead = topLaunch(snapshot);
  const focus = userPrompt.trim() || "PumpPortal memecoin pulse";
  return [
    "Create a 20-30s vertical hype video for Web3 social distribution.",
    "Tone: fast, clear, credible. No fabricated numbers.",
    "",
    `FOCUS: ${focus}`,
    `RECAP DATA: ${buildPumpRecap(snapshot)}`,
    `FLOW: buys ${formatSol(flow.buy)}, sells ${formatSol(flow.sell)}, net ${formatSol(flow.net)}`,
    lead
      ? `TOP LAUNCH: ${lead.symbol.toUpperCase()} (${trimText(lead.name, 28)}) at ${formatSol(lead.marketCapSol)}`
      : "TOP LAUNCH: Data unavailable",
    "",
    "OUTPUT FORMAT:",
    "1) Hook line (<= 12 words)",
    "2) Scene list with timestamps (0:00..end)",
    "3) On-screen text per scene",
    "4) Voiceover script",
    "5) CTA line optimized for reposts",
  ].join("\n");
}

export function buildPumpSocialThreadTemplate(
  snapshot: PumpSnapshot
): string {
  const flow = buySell(snapshot);
  return [
    "Write a 5-post social thread from this PumpPortal snapshot.",
    "Rules: include only given numbers, short lines, no financial advice.",
    `Data: ${buildPumpRecap(snapshot)}`,
    `Buy flow ${formatSol(flow.buy)} | Sell flow ${formatSol(flow.sell)} | Net ${formatSol(flow.net)}`,
    "Format: Post 1 hook, posts 2-4 evidence, post 5 CTA.",
  ].join("\n");
}

export function buildPumpScreenshotPromptTemplate(
  snapshot: PumpSnapshot
): string {
  return [
    "Create 4 screenshot captions for a memecoin dashboard carousel.",
    "Each caption: <= 90 chars, number-first phrasing, no emoji required.",
    `Data baseline: ${buildPumpRecap(snapshot)}`,
    "Output as numbered list.",
  ].join("\n");
}

export function buildPumpTimelineSpec(
  snapshot: PumpSnapshot,
  userPrompt = ""
): TimelineSpec {
  const fps = 30;
  const clips: NonNullable<TimelineSpec["clips"]> = [];
  let cursor = 0;

  const addClip = (
    component: string,
    durationInFrames: number,
    props: Record<string, unknown>
  ) => {
    const id = `clip-${clips.length + 1}`;
    clips.push({
      id,
      trackId: "track-main",
      component,
      props,
      from: cursor,
      durationInFrames,
      transitionIn: { type: "fade", durationInFrames: 10 },
      transitionOut: { type: "fade", durationInFrames: 10 },
      motion: {
        enter: { opacity: 0, y: 40, duration: 12 },
        exit: { opacity: 0, y: -30, duration: 10 },
      },
    });
    cursor += durationInFrames;
  };

  const flow = buySell(snapshot);
  const lead = topLaunch(snapshot);
  const recap = buildPumpRecap(snapshot);
  const title = userPrompt.trim() || "PumpPortal Memecoin Pulse";

  addClip("TitleCard", 90, {
    title: trimText(title, 44),
    subtitle: trimText(recap, 88),
    backgroundColor: "#051b11",
    textColor: "#ecfeff",
  });

  addClip("StatCard", 75, {
    label: "New Launches",
    value: `${snapshot.newTokens.length}`,
    subtitle: "Captured in a 4-second window",
    accentColor: "#10b981",
  });

  addClip("SplitScreen", 75, {
    leftTitle: "Buy Flow",
    leftBody: formatSol(flow.buy),
    rightTitle: "Sell Flow",
    rightBody: formatSol(flow.sell),
    leftColor: "#10b981",
    rightColor: "#ef4444",
  });

  addClip("QuoteCard", 80, {
    quote: lead
      ? `Top launch: ${lead.symbol.toUpperCase()} at ${formatSol(lead.marketCapSol)}`
      : "No high-cap launch in current window",
    author: lead ? trimText(lead.name, 26) : "PumpPortal Snapshot",
  });

  addClip("TypingText", 95, {
    text: `Launches ${snapshot.newTokens.length} | Migrations ${snapshot.migrations.length} | Net ${formatSol(flow.net)}\nReplay this snapshot in 30s for momentum shifts.`,
    charsPerSecond: 22,
    showCursor: true,
    fontFamily: "monospace",
    fontSize: 44,
    textColor: "#00ff88",
    backgroundColor: "#04110a",
  });

  addClip("TextOverlay", 70, {
    text: "Follow for next pulse update",
    textColor: "#ffffff",
    backgroundColor: "#0b111a",
  });

  return {
    composition: {
      id: "PumpPortalHypeVertical",
      fps,
      width: 1080,
      height: 1920,
      durationInFrames: cursor,
    },
    tracks: [
      {
        id: "track-main",
        name: "Main",
        type: "video",
        enabled: true,
      },
    ],
    clips,
    audio: {
      tracks: [],
    },
  };
}

export function buildPumpScreenshotPlan(
  snapshot: PumpSnapshot
): PumpScreenshotPlanItem[] {
  const lead = topLaunch(snapshot);
  const flow = buySell(snapshot);
  const recap = buildPumpRecap(snapshot);
  const flowDirection =
    flow.net > 0 ? "buy pressure" : flow.net < 0 ? "sell pressure" : "balanced flow";

  return [
    {
      id: "shot-hook",
      title: "Hook Cover",
      purpose: "Lead image for reposts and previews",
      frameHint: 12,
      timestampHint: "00:00",
      recommendedCaption: trimText(`${snapshot.newTokens.length} launches in 4s. ${flowDirection}.`, 88),
    },
    {
      id: "shot-metrics",
      title: "Metrics Frame",
      purpose: "Show objective volume + migration counts",
      frameHint: 110,
      timestampHint: "00:03",
      recommendedCaption: trimText(recap, 88),
    },
    {
      id: "shot-top-launch",
      title: "Top Launch",
      purpose: "Highlight biggest token event for attention",
      frameHint: 220,
      timestampHint: "00:07",
      recommendedCaption: lead
        ? trimText(`Top launch ${lead.symbol.toUpperCase()} at ${formatSol(lead.marketCapSol)}.`, 88)
        : "Top launch data unavailable.",
    },
    {
      id: "shot-flow",
      title: "Flow Balance",
      purpose: "Explain buy/sell imbalance quickly",
      frameHint: 300,
      timestampHint: "00:10",
      recommendedCaption: trimText(`Buys ${formatSol(flow.buy)} vs sells ${formatSol(flow.sell)}.`, 88),
    },
    {
      id: "shot-cta",
      title: "CTA End Card",
      purpose: "Drive follow-through and repeat checks",
      frameHint: 430,
      timestampHint: "00:14",
      recommendedCaption: "Save this template and rerun every 30 seconds.",
    },
  ];
}

export function buildPumpMediaBundle(
  snapshot: PumpSnapshot,
  userPrompt = ""
): PumpMediaBundle {
  return {
    recap: buildPumpRecap(snapshot),
    timeline: buildPumpTimelineSpec(snapshot, userPrompt),
    screenshotPlan: buildPumpScreenshotPlan(snapshot),
    promptTemplates: {
      videoScript: buildPumpVideoPromptTemplate(snapshot, userPrompt),
      socialThread: buildPumpSocialThreadTemplate(snapshot),
      screenshotCaptions: buildPumpScreenshotPromptTemplate(snapshot),
      thumbnailHook: `Use this hook: "${snapshot.newTokens.length} launches in 4s | ${snapshot.migrations.length} migrations | ${buildPumpRecap(snapshot)}"`,
    },
  };
}
