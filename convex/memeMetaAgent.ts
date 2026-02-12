"use node";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { RAG } from "@convex-dev/rag";
import { v } from "convex/values";
import { api, components } from "./_generated/api";
import { action } from "./_generated/server";

type RagFilters = {
  symbol: string;
  mint: string;
  riskBand: string;
  topic: string;
};

const rag = new RAG<RagFilters>(components.rag as any, {
  textEmbeddingModel: createOpenAICompatible({
    name: "openrouter",
    baseURL: process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
    apiKey:
      process.env.OPENROUTER_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim(),
  }).embeddingModel(
    process.env.OPENROUTER_EMBEDDING_MODEL?.trim() ||
      process.env.EMBEDDING_MODEL?.trim() ||
      "openai/text-embedding-3-small"
  ),
  embeddingDimension: 1536,
  filterNames: ["symbol", "mint", "riskBand", "topic"],
});

function assertEmbeddingApiKeyConfigured() {
  const key =
    process.env.OPENROUTER_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "Convex embeddings are not configured. Set OPENROUTER_API_KEY (or OPENAI_API_KEY) in Convex environment variables."
    );
  }
}

const riskBandValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high")
);

const ingestArgs = {
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
  riskBand: riskBandValidator,
  imageUris: v.array(v.string()),
  narrative: v.string(),
  metaTags: v.array(v.string()),
  source: v.optional(v.string()),
  namespace: v.optional(v.string()),
};

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}

export const ingestTokenMeta = action({
  args: ingestArgs,
  returns: v.object({
    tracked: v.boolean(),
    namespace: v.string(),
  }),
  handler: async (ctx: any, args: any) => {
    assertEmbeddingApiKeyConfigured();

    const namespace = args.namespace?.trim() || "solana-memecoins";
    const symbol = normalizeSymbol(args.symbol);
    const source = args.source?.trim() || "helius-lookup";
    const tags = cleanTags(args.metaTags);
    const primaryTopic = tags[0] ?? "general";

    await ctx.runMutation(api.memeMeta.upsertTokenMeta, {
      mint: args.mint,
      symbol,
      name: args.name,
      canonicalMint: args.canonicalMint,
      lookupMode: args.lookupMode,
      searchedTicker: args.searchedTicker,
      sameTickerCount: args.sameTickerCount,
      suspiciousTickerCount: args.suspiciousTickerCount,
      sameTickerImageCount: args.sameTickerImageCount,
      trustScore: args.trustScore,
      riskBand: args.riskBand,
      imageUris: args.imageUris,
      narrative: args.narrative,
      source,
      metaTags: tags,
    });

    const importance =
      args.riskBand === "high" ? 1 : args.riskBand === "medium" ? 0.85 : 0.65;

    await rag.add(ctx, {
      namespace,
      key: `${args.mint.trim()}:${source}`,
      title: `${symbol}${args.name?.trim() ? ` · ${args.name.trim()}` : ""}`,
      text: args.narrative.trim(),
      importance,
      filterValues: [
        { name: "symbol", value: symbol },
        { name: "mint", value: args.mint.trim() },
        { name: "riskBand", value: args.riskBand },
        { name: "topic", value: primaryTopic },
      ],
    });

    return {
      tracked: true,
      namespace,
    };
  },
});

export const searchTokenNarratives = action({
  args: {
    query: v.string(),
    namespace: v.optional(v.string()),
    symbol: v.optional(v.string()),
    mint: v.optional(v.string()),
    limit: v.optional(v.number()),
    vectorScoreThreshold: v.optional(v.number()),
  },
  returns: v.object({
    namespace: v.string(),
    text: v.string(),
    resultCount: v.number(),
    results: v.array(v.any()),
    entries: v.array(v.any()),
    usage: v.any(),
  }),
  handler: async (ctx: any, args: any) => {
    assertEmbeddingApiKeyConfigured();

    const namespace = args.namespace?.trim() || "solana-memecoins";
    const filters: Array<{ name: "symbol" | "mint"; value: string }> = [];
    if (args.symbol?.trim()) {
      filters.push({ name: "symbol", value: normalizeSymbol(args.symbol) });
    }
    if (args.mint?.trim()) {
      filters.push({ name: "mint", value: args.mint.trim() });
    }
    const limit = Math.max(1, Math.min(args.limit ?? 8, 20));
    const threshold =
      args.vectorScoreThreshold != null
        ? Math.min(1, Math.max(0, args.vectorScoreThreshold))
        : 0.55;

    const out = await rag.search(ctx, {
      namespace,
      query: args.query.trim(),
      limit,
      vectorScoreThreshold: threshold,
      chunkContext: { before: 1, after: 1 },
      ...(filters.length > 0 ? { filters } : {}),
    });

    return {
      namespace,
      text: out.text,
      resultCount: out.results.length,
      results: out.results,
      entries: out.entries,
      usage: out.usage,
    };
  },
});
