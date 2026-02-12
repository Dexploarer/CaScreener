import { v } from "convex/values";
import { query } from "./_generated/server";

type RadarBucket = {
  symbol: string;
  docs: Array<any>;
};

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() || "";
}

export const listClusters = query({
  args: {
    limit: v.optional(v.number()),
    windowMs: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx: any, args: any) => {
    const limit = Math.max(1, Math.min(args.limit ?? 12, 50));
    const windowMs = Math.max(60_000, args.windowMs ?? 1000 * 60 * 60 * 24);
    const now = Date.now();
    const cutoff = now - windowMs;

    const recent = await ctx.db
      .query("memeTokenMeta")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(400);

    const withinWindow = recent.filter((doc: any) => doc.updatedAt >= cutoff);
    const grouped = new Map<string, RadarBucket>();
    for (const doc of withinWindow) {
      const symbol = String(doc.symbol || "").trim().toUpperCase();
      if (!symbol) continue;
      const bucket = grouped.get(symbol) ?? { symbol, docs: [] };
      bucket.docs.push(doc);
      grouped.set(symbol, bucket);
    }

    const clusters = [...grouped.values()].map((bucket) => {
      const docs = bucket.docs
        .slice()
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      const latest = docs[0];
      const previous = docs[1];
      const sampleSize = docs.length;
      const latestSuspicious = latest?.suspiciousTickerCount ?? 0;
      const latestTotal = latest?.sameTickerCount ?? 0;
      const previousSuspicious = previous?.suspiciousTickerCount ?? 0;
      const suspiciousRatio = pct(latestSuspicious, Math.max(1, latestTotal));
      const acceleration = Math.max(0, latestSuspicious - previousSuspicious);
      const avgTrustScore =
        docs.reduce(
          (sum, doc) => sum + (typeof doc.trustScore === "number" ? doc.trustScore : 0),
          0
        ) / Math.max(1, docs.filter((d) => typeof d.trustScore === "number").length);
      const freshnessBoost = Math.max(0, 18 - (now - latest.updatedAt) / (1000 * 60 * 20));
      const clusterScore =
        latestSuspicious * 8 +
        suspiciousRatio * 35 +
        acceleration * 12 +
        Math.log2(sampleSize + 1) * 7 +
        freshnessBoost;

      const topMints = docs
        .slice(0, 4)
        .map((doc) => String(doc.mint))
        .filter(Boolean);
      const summary = firstLine(latest?.narrative ?? "") ||
        `${bucket.symbol}: ${latestSuspicious}/${latestTotal} suspicious clones`;

      return {
        symbol: bucket.symbol,
        clusterScore: Number(clusterScore.toFixed(2)),
        sampleSize,
        latestUpdatedAt: latest.updatedAt,
        suspiciousRatio,
        acceleration,
        avgTrustScore: Number.isFinite(avgTrustScore) ? Number(avgTrustScore.toFixed(1)) : undefined,
        topMints,
        summary,
      };
    });

    return clusters
      .sort((a, b) => b.clusterScore - a.clusterScore)
      .slice(0, limit);
  },
});
