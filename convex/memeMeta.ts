import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

const upsertArgs = {
  mint: v.string(),
  symbol: v.string(),
  name: v.optional(v.string()),
  canonicalMint: v.optional(v.string()),
  lookupMode: v.union(v.literal("mint"), v.literal("ticker")),
  searchedTicker: v.optional(v.string()),
  sameTickerCount: v.number(),
  suspiciousTickerCount: v.number(),
  sameTickerImageCount: v.optional(v.number()),
  trustScore: v.optional(v.number()),
  riskBand: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  imageUris: v.array(v.string()),
  narrative: v.string(),
  metaTags: v.array(v.string()),
  source: v.optional(v.string()),
};

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

export const upsertTokenMeta = mutation({
  args: upsertArgs,
  returns: v.object({
    id: v.id("memeTokenMeta"),
    isNew: v.boolean(),
  }),
  handler: async (ctx: any, args: any) => {
    const mint = args.mint.trim();
    const symbol = normalizeSymbol(args.symbol);
    if (!mint || !symbol) {
      throw new ConvexError("mint and symbol are required");
    }
    const now = Date.now();
    const source = args.source?.trim() || "helius-lookup";
    const sanitizedTags = [...new Set(args.metaTags.map((tag: any) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 24);
    const sanitizedImages = [...new Set(args.imageUris.map((uri: any) => uri.trim()).filter(Boolean))].slice(0, 50);
    const existing = await ctx.db
      .query("memeTokenMeta")
      .withIndex("by_mint", (q: any) => q.eq("mint", mint))
      .first();

    const payload = {
      mint,
      symbol,
      name: args.name?.trim() || undefined,
      canonicalMint: args.canonicalMint?.trim() || undefined,
      lookupMode: args.lookupMode,
      searchedTicker: args.searchedTicker?.trim().toUpperCase() || undefined,
      sameTickerCount: Math.max(0, args.sameTickerCount),
      suspiciousTickerCount: Math.max(0, args.suspiciousTickerCount),
      sameTickerImageCount: args.sameTickerImageCount != null ? Math.max(0, args.sameTickerImageCount) : undefined,
      trustScore:
        typeof args.trustScore === "number"
          ? Math.max(0, Math.min(100, args.trustScore))
          : undefined,
      riskBand: args.riskBand,
      imageUris: sanitizedImages,
      narrative: args.narrative.trim(),
      metaTags: sanitizedTags,
      source,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return { id: existing._id, isNew: false };
    }

    const id = await ctx.db.insert("memeTokenMeta", {
      ...payload,
      firstSeenAt: now,
    });
    return { id, isNew: true };
  },
});

export const getByMint = query({
  args: { mint: v.string() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx: any, args: any) => {
    const mint = args.mint.trim();
    if (!mint) return null;
    return await ctx.db
      .query("memeTokenMeta")
      .withIndex("by_mint", (q: any) => q.eq("mint", mint))
      .first();
  },
});

export const listBySymbol = query({
  args: {
    symbol: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx: any, args: any) => {
    const symbol = normalizeSymbol(args.symbol);
    const limit = Math.max(1, Math.min(args.limit ?? 30, 100));
    if (!symbol) return [];
    return await ctx.db
      .query("memeTokenMeta")
      .withIndex("by_symbol_updatedAt", (q: any) => q.eq("symbol", symbol))
      .order("desc")
      .take(limit);
  },
});

export const listRecent = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx: any, args: any) => {
    const limit = Math.max(1, Math.min(args.limit ?? 30, 100));
    return await ctx.db
      .query("memeTokenMeta")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(limit);
  },
});
