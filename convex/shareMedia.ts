import { WorkflowManager } from "@convex-dev/workflow";
import { ConvexError, v } from "convex/values";
import { api, components, internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";

const workflow = new WorkflowManager(components.workflow as any);

type EnqueueVideoMirrorResult = {
  jobId: string;
  status: string;
  workflowId: string;
};

function makePublicId(): string {
  return `sm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export const mirrorRenderedVideoWorkflow = workflow.define({
  args: {
    publicId: v.string(),
    sourceUrl: v.string(),
    tokenId: v.optional(v.string()),
    tokenSymbol: v.optional(v.string()),
  },
  handler: async (step: any, args: any): Promise<void> => {
    try {
      const stored = await step.runAction(api.shareMediaNode.fetchAndStoreVideoToR2 as any, {
        publicId: args.publicId,
        sourceUrl: args.sourceUrl,
        tokenId: args.tokenId,
        tokenSymbol: args.tokenSymbol,
      }, { retry: true });

      await step.runMutation(api.shareMedia.markMirrorSuccess as any, {
        publicId: args.publicId,
        r2Key: stored.r2Key,
        r2Url: stored.r2Url,
        sizeBytes: stored.sizeBytes,
      });
    } catch (error) {
      await step.runMutation(api.shareMedia.markMirrorFailure as any, {
        publicId: args.publicId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});

export const enqueueVideoMirror: any = mutation({
  args: {
    sourceUrl: v.string(),
    tokenId: v.optional(v.string()),
    tokenSymbol: v.optional(v.string()),
    requestedBy: v.optional(v.string()),
  },
  returns: v.object({
    jobId: v.string(),
    status: v.string(),
    workflowId: v.string(),
  }),
  handler: async (
    ctx: any,
    args: any
  ): Promise<EnqueueVideoMirrorResult> => {
    const now = Date.now();
    const publicId = makePublicId();
    const sourceUrl = args.sourceUrl.trim();
    if (!sourceUrl) {
      throw new ConvexError("sourceUrl is required");
    }

    const insertedId = await ctx.db.insert("shareMediaJobs", {
      publicId,
      sourceUrl,
      tokenId: args.tokenId?.trim() || undefined,
      tokenSymbol: args.tokenSymbol?.trim() || undefined,
      requestedBy: args.requestedBy?.trim() || undefined,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });

    const workflowRef = internal.shareMedia.mirrorRenderedVideoWorkflow as any;
    const workflowId: string = String(
      await workflow.start(
        ctx,
        workflowRef,
        {
          publicId,
          sourceUrl,
          tokenId: args.tokenId?.trim() || undefined,
          tokenSymbol: args.tokenSymbol?.trim() || undefined,
        }
      )
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

export const markMirrorSuccess = mutation({
  args: {
    publicId: v.string(),
    r2Key: v.string(),
    r2Url: v.string(),
    sizeBytes: v.number(),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx: any, args: any) => {
    const job = await ctx.db
      .query("shareMediaJobs")
      .withIndex("by_publicId", (q: any) => q.eq("publicId", args.publicId))
      .first();
    if (!job) return { ok: false };

    await ctx.db.patch(job._id, {
      status: "mirrored",
      r2Key: args.r2Key,
      r2Url: args.r2Url,
      sizeBytes: args.sizeBytes,
      error: undefined,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const markMirrorFailure = mutation({
  args: {
    publicId: v.string(),
    error: v.string(),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx: any, args: any) => {
    const job = await ctx.db
      .query("shareMediaJobs")
      .withIndex("by_publicId", (q: any) => q.eq("publicId", args.publicId))
      .first();
    if (!job) return { ok: false };

    await ctx.db.patch(job._id, {
      status: "failed",
      error: args.error.trim().slice(0, 1000),
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const getJobByPublicId = query({
  args: { jobId: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx: any, args: any) => {
    const jobId = args.jobId.trim();
    if (!jobId) return null;

    const job = await ctx.db
      .query("shareMediaJobs")
      .withIndex("by_publicId", (q: any) => q.eq("publicId", jobId))
      .first();
    if (!job) return null;

    return {
      jobId: job.publicId,
      status: job.status,
      workflowId: job.workflowId,
      sourceUrl: job.sourceUrl,
      tokenId: job.tokenId,
      tokenSymbol: job.tokenSymbol,
      requestedBy: job.requestedBy,
      r2Key: job.r2Key,
      r2Url: job.r2Url,
      sizeBytes: job.sizeBytes,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  },
});

export const listRecentJobs = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx: any, args: any) => {
    const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
    const rows = await ctx.db
      .query("shareMediaJobs")
      .withIndex("by_createdAt")
      .order("desc")
      .take(limit);

    return rows.map((job: any) => ({
      jobId: job.publicId,
      status: job.status,
      tokenId: job.tokenId,
      tokenSymbol: job.tokenSymbol,
      r2Url: job.r2Url,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }));
  },
});
