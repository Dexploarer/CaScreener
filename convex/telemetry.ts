import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const ingest = mutation({
  args: {
    event: v.string(),
    userId: v.string(),
    sessionId: v.optional(v.string()),
    page: v.optional(v.string()),
    properties: v.optional(v.any()),
    ts: v.number(),
  },
  returns: v.object({ stored: v.boolean() }),
  handler: async (ctx: any, args: any) => {
    await ctx.db.insert("telemetryEvents", {
      event: args.event.trim(),
      userId: args.userId.trim() || "anonymous",
      sessionId: args.sessionId?.trim() || undefined,
      page: args.page?.trim() || undefined,
      properties: args.properties ?? {},
      ts: args.ts,
    });
    return { stored: true };
  },
});

export const summarize = query({
  args: {
    windowMs: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx: any, args: any) => {
    const windowMs = Math.max(60_000, args.windowMs ?? 1000 * 60 * 60 * 24);
    const cutoff = Date.now() - windowMs;
    const rows = await ctx.db
      .query("telemetryEvents")
      .withIndex("by_ts")
      .order("desc")
      .take(2_000);
    const filtered = rows.filter((row: any) => row.ts >= cutoff);
    const counts = new Map<string, number>();
    for (const row of filtered) {
      const key = String(row.event || "unknown");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([event, count]) => ({ event, count }))
      .sort((a, b) => b.count - a.count);
  },
});
