import type { TimelineSpec } from "@json-render/remotion";
import type { TokenLookupResult } from "@/lib/helius/types";
import type { TokenTrustScore } from "@/lib/helius/trust-score";

export type SharePackPayload = {
  generatedAt: string;
  summary: string;
  thread: string[];
  xIntentUrl: string;
  farcasterIntentUrl: string;
  imageCard: {
    title: string;
    subtitle: string;
    bullets: string[];
    cta: string;
    imageUrl?: string;
  };
  hypeVideo: {
    hook: string;
    timeline: TimelineSpec;
    promptTemplate: string;
  };
  hardLinks: {
    mint: string;
    pair?: string;
    tx?: string;
    liquidity?: string;
  };
};

export function buildSharePackOgImageUrl(
  baseOrigin: string,
  token: TokenLookupResult,
  trust: TokenTrustScore,
  summary: string
): string {
  const symbol = token.symbol?.trim().toUpperCase() || "TOKEN";
  const suspicious = token.suspiciousTickerCount ?? 0;
  const total = token.sameTickerCount ?? token.sameTickerTokens?.length ?? 0;
  const image = token.imageUris?.[0] ?? token.imageUri ?? "";
  const pair = trust.hardLinks.pair ?? "";

  const params = new URLSearchParams({
    symbol,
    name: token.name?.trim() || symbol,
    score: String(trust.score),
    grade: trust.grade,
    suspicious: String(suspicious),
    total: String(total),
    mint: token.id,
    summary,
  });
  if (image) params.set("image", image);
  if (pair) params.set("pair", pair);

  return `${baseOrigin.replace(/\/$/, "")}/api/share/og-image?${params.toString()}`;
}

function esc(text: string): string {
  return encodeURIComponent(text);
}

function trimText(value: string, max = 78): string {
  const t = value.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 3)}...`;
}

function asUsd(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

function makeTimeline(
  token: TokenLookupResult,
  trust: TokenTrustScore
): TimelineSpec {
  const fps = 30;
  const clips: NonNullable<TimelineSpec["clips"]> = [];
  let cursor = 0;

  const addClip = (
    component: string,
    durationInFrames: number,
    props: Record<string, unknown>
  ) => {
    clips.push({
      id: `clip-${clips.length + 1}`,
      trackId: "main",
      component,
      props,
      from: cursor,
      durationInFrames,
      transitionIn: { type: "fade", durationInFrames: 8 },
      transitionOut: { type: "fade", durationInFrames: 8 },
    });
    cursor += durationInFrames;
  };

  const symbol = token.symbol?.trim().toUpperCase() || "TOKEN";
  const total = token.sameTickerCount ?? token.sameTickerTokens?.length ?? 0;
  const suspicious = token.suspiciousTickerCount ?? 0;
  const top = token.sameTickerTokens?.[0];

  addClip("TitleCard", 72, {
    title: `${symbol} Trust Scan`,
    subtitle: `Score ${trust.score}/100 (${trust.grade})`,
    backgroundColor: "#0b111a",
    textColor: "#e2e8f0",
  });

  addClip("StatCard", 72, {
    label: "Same Ticker Listings",
    value: `${total}`,
    subtitle: `Suspicious: ${suspicious}`,
    accentColor: suspicious > 0 ? "#fb923c" : "#34d399",
  });

  addClip("SplitScreen", 72, {
    leftTitle: "Trust Score",
    leftBody: `${trust.score}/100`,
    rightTitle: "Grade",
    rightBody: trust.grade,
    leftColor: "#34d399",
    rightColor: trust.grade === "A" ? "#34d399" : trust.grade === "B" ? "#a3e635" : "#fb923c",
  });

  addClip("QuoteCard", 80, {
    quote: top
      ? `${top.symbol} top pair liquidity ${asUsd(top.liquidityUsd)}`
      : "No market pair found in this scan window",
    author: token.name?.trim() || symbol,
  });

  addClip("TypingText", 96, {
    text: `Mint: ${token.id}\nScore ${trust.score}/100 · ${total} same-ticker listings · ${suspicious} suspicious`,
    charsPerSecond: 28,
    showCursor: true,
    fontFamily: "monospace",
    fontSize: 36,
    textColor: "#60a5fa",
    backgroundColor: "#030712",
  });

  addClip("TextOverlay", 66, {
    text: "Save, share, and verify before ape-ing.",
    textColor: "#ffffff",
    backgroundColor: "#111827",
  });

  return {
    composition: {
      id: "MemeTokenTrustShare",
      fps,
      width: 1080,
      height: 1920,
      durationInFrames: cursor,
    },
    tracks: [
      {
        id: "main",
        name: "Main",
        type: "video",
        enabled: true,
      },
    ],
    clips,
    audio: { tracks: [] },
  };
}

export function buildTokenSharePack(
  token: TokenLookupResult,
  trust: TokenTrustScore
): SharePackPayload {
  const symbol = token.symbol?.trim().toUpperCase() || "TOKEN";
  const suspicious = token.suspiciousTickerCount ?? 0;
  const total = token.sameTickerCount ?? token.sameTickerTokens?.length ?? 0;
  const pairLink = trust.hardLinks.pair ?? `https://explorer.solana.com/address/${token.id}`;

  const thread = [
    `${symbol} scan: trust ${trust.score}/100 (${trust.grade}).`,
    `Found ${suspicious} suspicious tokens out of ${total} with same ticker on Solana.`,
    `Mint: ${token.id}`,
    `Pair + liquidity proof: ${pairLink}`,
    "Always verify mint + liquidity + tx flow before entering.",
  ];

  const summary = trimText(
    `${symbol} trust ${trust.score}/100 (${trust.grade}) · ${suspicious}/${total} suspicious clones`
  );

  const cardBullets = [
    `Trust score: ${trust.score}/100 (${trust.grade})`,
    `Suspicious listings: ${suspicious}/${total}`,
    `Mint: ${trimText(token.id, 44)}`,
    `Pair proof: ${pairLink}`,
  ];

  const socialPost = `${summary}\n\nMint: ${token.id}\nPair: ${pairLink}`;
  const xIntentUrl = `https://x.com/intent/tweet?text=${esc(socialPost)}`;
  const farcasterIntentUrl = `https://warpcast.com/~/compose?text=${esc(socialPost)}`;

  const hook = `${symbol}: ${suspicious}/${total} suspicious clones flagged`;
  return {
    generatedAt: new Date().toISOString(),
    summary,
    thread,
    xIntentUrl,
    farcasterIntentUrl,
    imageCard: {
      title: `${symbol} Clone Guard`,
      subtitle: `Trust ${trust.score}/100 · Grade ${trust.grade}`,
      bullets: cardBullets,
      cta: "Verify before buying.",
    },
    hypeVideo: {
      hook,
      timeline: makeTimeline(token, trust),
      promptTemplate: [
        "Create a high-energy 20-30s vertical social clip for memecoin traders.",
        "Do not fabricate numbers. Use only provided scan data.",
        `Hook: ${hook}`,
        `Trust Score: ${trust.score}/100 (${trust.grade})`,
        `Mint: ${token.id}`,
        `Suspicious: ${suspicious}/${total}`,
        `Proof Link: ${pairLink}`,
        "Output: shot list + on-screen captions + voiceover + CTA.",
      ].join("\n"),
    },
    hardLinks: trust.hardLinks,
  };
}
