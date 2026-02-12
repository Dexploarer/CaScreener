import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  memeTokenMeta: defineTable({
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
    source: v.string(),
    firstSeenAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_mint", ["mint"])
    .index("by_symbol", ["symbol"])
    .index("by_symbol_updatedAt", ["symbol", "updatedAt"])
    .index("by_updatedAt", ["updatedAt"]),
  watchlists: defineTable({
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
  })
    .index("by_user", ["userId"])
    .index("by_user_ticker", ["userId", "ticker"])
    .index("by_ticker", ["ticker"]),
  watchAlerts: defineTable({
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
    createdAt: v.number(),
  })
    .index("by_user_createdAt", ["userId", "createdAt"])
    .index("by_ticker_createdAt", ["ticker", "createdAt"]),
  telemetryEvents: defineTable({
    event: v.string(),
    userId: v.string(),
    sessionId: v.optional(v.string()),
    page: v.optional(v.string()),
    properties: v.optional(v.any()),
    ts: v.number(),
  })
    .index("by_event_ts", ["event", "ts"])
    .index("by_user_ts", ["userId", "ts"])
    .index("by_ts", ["ts"]),
  shareMediaJobs: defineTable({
    publicId: v.string(),
    sourceUrl: v.string(),
    tokenId: v.optional(v.string()),
    tokenSymbol: v.optional(v.string()),
    requestedBy: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("mirrored"),
      v.literal("failed")
    ),
    workflowId: v.optional(v.string()),
    r2Key: v.optional(v.string()),
    r2Url: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_publicId", ["publicId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_requestedBy_createdAt", ["requestedBy", "createdAt"]),
  tokenIntelRuns: defineTable({
    publicId: v.string(),
    query: v.string(),
    symbol: v.optional(v.string()),
    mint: v.optional(v.string()),
    namespace: v.optional(v.string()),
    requestedBy: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),
    workflowId: v.optional(v.string()),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_publicId", ["publicId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_symbol_createdAt", ["symbol", "createdAt"]),
});
