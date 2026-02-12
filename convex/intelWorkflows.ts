import { WorkflowManager } from "@convex-dev/workflow";
import { ConvexError, v } from "convex/values";
import { api, components, internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";

const workflow = new WorkflowManager(components.workflow as any);

function makePublicId(): string {
  return `ti_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeSymbol(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : undefined;
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function asErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split("\n")[0]?.trim() || "unknown error";
  return firstLine.slice(0, 220);
}

export const hydrateTokenIntelWorkflow = workflow.define({
  args: {
    publicId: v.string(),
    query: v.string(),
    symbol: v.optional(v.string()),
    mint: v.optional(v.string()),
    namespace: v.optional(v.string()),
  },
  handler: async (step: any, args: any): Promise<void> => {
    const startedAt = Date.now();
    const queryText =
      trimOrUndefined(args.query) ||
      trimOrUndefined(args.symbol) ||
      trimOrUndefined(args.mint) ||
      "memecoin clone scan";
    const symbol = normalizeSymbol(args.symbol);
    const mint = trimOrUndefined(args.mint);
    const namespace = trimOrUndefined(args.namespace) || "solana-memecoins";
    const errors: string[] = [];

    try {
      let narrativeResult: any = null;
      let bySymbol: any[] = [];
      let watchers: any[] = [];
      let clusters: any[] = [];
      let telemetry: any[] = [];

      try {
        narrativeResult = await step.runAction(
          (api as any).memeMetaAgent.searchTokenNarratives,
          {
            query: queryText,
            symbol,
            mint,
            namespace,
            limit: 10,
            vectorScoreThreshold: 0.45,
          }
        );
      } catch (error) {
        errors.push(`narrative: ${asErrorMessage(error)}`);
      }

      if (symbol) {
        try {
          bySymbol = await step.runQuery((api as any).memeMeta.listBySymbol, {
            symbol,
            limit: 40,
          });
        } catch (error) {
          errors.push(`symbol_meta: ${asErrorMessage(error)}`);
        }

        try {
          watchers = await step.runQuery(
            (api as any).watchlists.listActiveByTicker,
            { ticker: symbol }
          );
        } catch (error) {
          errors.push(`watchers: ${asErrorMessage(error)}`);
        }
      }

      try {
        clusters = await step.runQuery((api as any).metaRadar.listClusters, {
          limit: 12,
          windowMs: 1000 * 60 * 60 * 24,
        });
      } catch (error) {
        errors.push(`meta_radar: ${asErrorMessage(error)}`);
      }

      try {
        telemetry = await step.runQuery((api as any).telemetry.summarize, {
          windowMs: 1000 * 60 * 60 * 24,
        });
      } catch (error) {
        errors.push(`telemetry: ${asErrorMessage(error)}`);
      }

      const symbolDocs = Array.isArray(bySymbol) ? bySymbol : [];
      const suspiciousDocsCount = symbolDocs.filter(
        (doc: any) =>
          typeof doc?.suspiciousTickerCount === "number" &&
          doc.suspiciousTickerCount > 0
      ).length;
      const topClusters = (Array.isArray(clusters) ? clusters : [])
        .slice(0, 6)
        .map((cluster: any) => ({
          symbol: String(cluster?.symbol ?? "").toUpperCase(),
          clusterScore:
            typeof cluster?.clusterScore === "number" ? cluster.clusterScore : 0,
          suspiciousRatio:
            typeof cluster?.suspiciousRatio === "number"
              ? cluster.suspiciousRatio
              : 0,
          acceleration:
            typeof cluster?.acceleration === "number"
              ? cluster.acceleration
              : 0,
          summary: String(cluster?.summary ?? ""),
        }))
        .filter((cluster: any) => cluster.symbol);
      const telemetryTop = (Array.isArray(telemetry) ? telemetry : [])
        .slice(0, 8)
        .map((entry: any) => ({
          event: String(entry?.event ?? "unknown"),
          count: Number(entry?.count ?? 0),
        }));

      const result = {
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        query: queryText,
        symbol,
        mint,
        namespace,
        narrativeHits:
          typeof narrativeResult?.resultCount === "number"
            ? narrativeResult.resultCount
            : 0,
        narrativeSummary:
          typeof narrativeResult?.text === "string"
            ? narrativeResult.text.slice(0, 4000)
            : "",
        symbolDocsCount: symbolDocs.length,
        suspiciousDocsCount,
        watchlistCount: Array.isArray(watchers) ? watchers.length : 0,
        topClusters,
        telemetryTop,
        errors,
      };

      await step.runMutation(
        (api as any).intelWorkflows.markTokenIntelRunSuccess,
        {
          publicId: args.publicId,
          result,
        }
      );
    } catch (error) {
      await step.runMutation(
        (api as any).intelWorkflows.markTokenIntelRunFailure,
        {
          publicId: args.publicId,
          error: asErrorMessage(error),
        }
      );
      throw error;
    }
  },
});

export const enqueueTokenIntelHydration = mutation({
  args: {
    query: v.string(),
    symbol: v.optional(v.string()),
    mint: v.optional(v.string()),
    namespace: v.optional(v.string()),
    requestedBy: v.optional(v.string()),
  },
  returns: v.object({
    jobId: v.string(),
    status: v.string(),
    workflowId: v.string(),
  }),
  handler: async (ctx: any, args: any) => {
    const query = args.query.trim();
    if (!query) {
      throw new ConvexError("query is required");
    }

    const now = Date.now();
    const publicId = makePublicId();
    const symbol = normalizeSymbol(args.symbol);
    const mint = trimOrUndefined(args.mint);
    const namespace = trimOrUndefined(args.namespace);
    const requestedBy = trimOrUndefined(args.requestedBy);

    const insertedId = await ctx.db.insert("tokenIntelRuns", {
      publicId,
      query,
      symbol,
      mint,
      namespace,
      requestedBy,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });

    const workflowRef = (internal as any).intelWorkflows
      .hydrateTokenIntelWorkflow as any;
    const workflowId: string = String(
      await workflow.start(ctx, workflowRef, {
        publicId,
        query,
        symbol,
        mint,
        namespace,
      })
    );

    await ctx.db.patch(insertedId, {
      status: "processing",
      workflowId,
      updatedAt: Date.now(),
    });

    return {
      jobId: publicId,
      status: "processing",
      workflowId,
    };
  },
});

export const markTokenIntelRunSuccess = mutation({
  args: {
    publicId: v.string(),
    result: v.any(),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx: any, args: any) => {
    const run = await ctx.db
      .query("tokenIntelRuns")
      .withIndex("by_publicId", (q: any) => q.eq("publicId", args.publicId))
      .first();
    if (!run) return { ok: false };

    await ctx.db.patch(run._id, {
      status: "completed",
      result: args.result,
      error: undefined,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const markTokenIntelRunFailure = mutation({
  args: {
    publicId: v.string(),
    error: v.string(),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx: any, args: any) => {
    const run = await ctx.db
      .query("tokenIntelRuns")
      .withIndex("by_publicId", (q: any) => q.eq("publicId", args.publicId))
      .first();
    if (!run) return { ok: false };

    await ctx.db.patch(run._id, {
      status: "failed",
      error: args.error.trim().slice(0, 1000),
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const getTokenIntelRun = query({
  args: { jobId: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx: any, args: any) => {
    const jobId = args.jobId.trim();
    if (!jobId) return null;

    const run = await ctx.db
      .query("tokenIntelRuns")
      .withIndex("by_publicId", (q: any) => q.eq("publicId", jobId))
      .first();
    if (!run) return null;

    return {
      jobId: run.publicId,
      status: run.status,
      workflowId: run.workflowId,
      query: run.query,
      symbol: run.symbol,
      mint: run.mint,
      namespace: run.namespace,
      requestedBy: run.requestedBy,
      result: run.result,
      error: run.error,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  },
});

export const listRecentTokenIntelRuns = query({
  args: {
    limit: v.optional(v.number()),
    symbol: v.optional(v.string()),
  },
  returns: v.array(v.any()),
  handler: async (ctx: any, args: any) => {
    const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
    const symbol = normalizeSymbol(args.symbol);

    if (symbol) {
      const rows = await ctx.db
        .query("tokenIntelRuns")
        .withIndex("by_symbol_createdAt", (q: any) => q.eq("symbol", symbol))
        .order("desc")
        .take(limit);
      return rows.map((row: any) => ({
        jobId: row.publicId,
        status: row.status,
        query: row.query,
        symbol: row.symbol,
        mint: row.mint,
        workflowId: row.workflowId,
        error: row.error,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
    }

    const rows = await ctx.db
      .query("tokenIntelRuns")
      .withIndex("by_createdAt")
      .order("desc")
      .take(limit);
    return rows.map((row: any) => ({
      jobId: row.publicId,
      status: row.status,
      query: row.query,
      symbol: row.symbol,
      mint: row.mint,
      workflowId: row.workflowId,
      error: row.error,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },
});

export const getLatestCompletedBySymbol = query({
  args: {
    symbol: v.string(),
  },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx: any, args: any) => {
    const symbol = normalizeSymbol(args.symbol);
    if (!symbol) return null;

    const rows = await ctx.db
      .query("tokenIntelRuns")
      .withIndex("by_symbol_createdAt", (q: any) => q.eq("symbol", symbol))
      .order("desc")
      .take(20);
    const latest = rows.find((row: any) => row.status === "completed" && !!row.result);
    if (!latest) return null;

    return {
      jobId: latest.publicId,
      status: latest.status,
      workflowId: latest.workflowId,
      query: latest.query,
      symbol: latest.symbol,
      mint: latest.mint,
      namespace: latest.namespace,
      requestedBy: latest.requestedBy,
      result: latest.result,
      error: latest.error,
      createdAt: latest.createdAt,
      updatedAt: latest.updatedAt,
    };
  },
});
