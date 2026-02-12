"use node";

import { R2 } from "@convex-dev/r2";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { action } from "./_generated/server";

const r2 = new R2(components.r2 as any);

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export const fetchAndStoreVideoToR2 = action({
  args: {
    publicId: v.string(),
    sourceUrl: v.string(),
    tokenId: v.optional(v.string()),
    tokenSymbol: v.optional(v.string()),
  },
  returns: v.object({
    r2Key: v.string(),
    r2Url: v.string(),
    sizeBytes: v.number(),
  }),
  handler: async (ctx: any, args: any) => {
    const sourceUrl = args.sourceUrl.trim();
    if (!sourceUrl) {
      throw new Error("sourceUrl is required");
    }

    const response = await fetch(sourceUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Source fetch failed (${response.status})`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new Error("Rendered video was empty");
    }

    const symbolSegment = args.tokenSymbol ? sanitizeSegment(args.tokenSymbol) : "token";
    const tokenSegment = args.tokenId ? sanitizeSegment(args.tokenId) : "unknown";
    const key = `share-videos/${symbolSegment}/${tokenSegment}/${sanitizeSegment(args.publicId)}.mp4`;

    const r2Key = await r2.store(ctx, bytes, {
      key,
      type: "video/mp4",
      cacheControl: "public, max-age=31536000, immutable",
      disposition: `inline; filename=\"${sanitizeSegment(args.publicId)}.mp4\"`,
    });
    const r2Url = await r2.getUrl(r2Key);

    return {
      r2Key,
      r2Url,
      sizeBytes: bytes.byteLength,
    };
  },
});
