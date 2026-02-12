import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

export const subscribe = mutation({
  args: {
    userId: v.string(),
    ticker: v.string(),
    mint: v.optional(v.string()),
    web: v.boolean(),
    telegramChatId: v.optional(v.string()),
    discordWebhookUrl: v.optional(v.string()),
  },
  returns: v.object({
    id: v.string(),
    userId: v.string(),
    ticker: v.string(),
    mint: v.optional(v.string()),
    web: v.boolean(),
    telegramChatId: v.optional(v.string()),
    discordWebhookUrl: v.optional(v.string()),
    lastSeenSuspicious: v.number(),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastAlertAt: v.optional(v.number()),
  }),
  handler: async (ctx: any, args: any) => {
    const userId = args.userId.trim();
    const ticker = normalizeTicker(args.ticker);
    if (!userId || !ticker) {
      throw new ConvexError("userId and ticker are required");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("watchlists")
      .withIndex("by_user_ticker", (q: any) => q.eq("userId", userId).eq("ticker", ticker))
      .first();

    const payload = {
      userId,
      ticker,
      mint: args.mint?.trim() || undefined,
      web: !!args.web,
      telegramChatId: args.telegramChatId?.trim() || undefined,
      discordWebhookUrl: args.discordWebhookUrl?.trim() || undefined,
      active: true,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      const updated = await ctx.db.get(existing._id);
      return {
        id: String(updated._id),
        userId: updated.userId,
        ticker: updated.ticker,
        mint: updated.mint,
        web: updated.web,
        telegramChatId: updated.telegramChatId,
        discordWebhookUrl: updated.discordWebhookUrl,
        lastSeenSuspicious: updated.lastSeenSuspicious ?? 0,
        active: updated.active,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        lastAlertAt: updated.lastAlertAt,
      };
    }

    const id = await ctx.db.insert("watchlists", {
      ...payload,
      createdAt: now,
      lastSeenSuspicious: 0,
    });
    return {
      id: String(id),
      userId,
      ticker,
      mint: payload.mint,
      web: payload.web,
      telegramChatId: payload.telegramChatId,
      discordWebhookUrl: payload.discordWebhookUrl,
      lastSeenSuspicious: 0,
      active: true,
      createdAt: now,
      updatedAt: now,
      lastAlertAt: undefined,
    };
  },
});

export const unsubscribe = mutation({
  args: {
    userId: v.string(),
    ticker: v.string(),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx: any, args: any) => {
    const userId = args.userId.trim();
    const ticker = normalizeTicker(args.ticker);
    const existing = await ctx.db
      .query("watchlists")
      .withIndex("by_user_ticker", (q: any) => q.eq("userId", userId).eq("ticker", ticker))
      .first();
    if (!existing) return { ok: false };
    await ctx.db.patch(existing._id, {
      active: false,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const listByUser = query({
  args: { userId: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx: any, args: any) => {
    const userId = args.userId.trim();
    if (!userId) return [];
    const rows = await ctx.db
      .query("watchlists")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .order("desc")
      .collect();
    return rows
      .filter((row: any) => row.active)
      .map((row: any) => ({
        id: String(row._id),
        userId: row.userId,
        ticker: row.ticker,
        mint: row.mint,
        web: row.web,
        telegramChatId: row.telegramChatId,
        discordWebhookUrl: row.discordWebhookUrl,
        lastSeenSuspicious: row.lastSeenSuspicious ?? 0,
        active: row.active,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lastAlertAt: row.lastAlertAt,
      }));
  },
});

export const listActiveByTicker = query({
  args: { ticker: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx: any, args: any) => {
    const ticker = normalizeTicker(args.ticker);
    const rows = await ctx.db
      .query("watchlists")
      .withIndex("by_ticker", (q: any) => q.eq("ticker", ticker))
      .collect();
    return rows.filter((row: any) => row.active);
  },
});

export const listAlertsByUser = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx: any, args: any) => {
    const userId = args.userId.trim();
    const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
    const rows = await ctx.db
      .query("watchAlerts")
      .withIndex("by_user_createdAt", (q: any) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
    return rows.map((row: any) => ({
      id: String(row._id),
      userId: row.userId,
      ticker: row.ticker,
      mint: row.mint,
      previousSuspicious: row.previousSuspicious,
      currentSuspicious: row.currentSuspicious,
      message: row.message,
      channels: row.channels,
      createdAt: row.createdAt,
    }));
  },
});

export const recordAlert = mutation({
  args: {
    watchlistId: v.string(),
    userId: v.string(),
    ticker: v.string(),
    mint: v.optional(v.string()),
    previousSuspicious: v.number(),
    currentSuspicious: v.number(),
    message: v.string(),
    channels: v.array(v.string()),
    delivered: v.object({
      web: v.boolean(),
      telegram: v.boolean(),
      discord: v.boolean(),
    }),
    trustScore: v.optional(v.number()),
    pairUrl: v.optional(v.string()),
    explorerUrl: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    await ctx.db.insert("watchAlerts", {
      userId: args.userId,
      ticker: normalizeTicker(args.ticker),
      mint: args.mint?.trim() || undefined,
      previousSuspicious: args.previousSuspicious,
      currentSuspicious: args.currentSuspicious,
      message: args.message.trim(),
      channels: args.channels,
      delivered: args.delivered,
      trustScore: args.trustScore,
      pairUrl: args.pairUrl,
      explorerUrl: args.explorerUrl,
      createdAt: now,
    });

    const watchlistDoc = await ctx.db.get(args.watchlistId);
    if (watchlistDoc) {
      await ctx.db.patch(watchlistDoc._id, {
        lastSeenSuspicious: args.currentSuspicious,
        lastAlertAt: now,
        updatedAt: now,
      });
    }
    return { ok: true };
  },
});
