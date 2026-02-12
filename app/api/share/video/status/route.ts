import {
  getShareVideoMirrorJobInConvex,
  isConvexTrackingEnabled,
} from "@/lib/meme-meta/convex-rag";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request): Promise<Response> {
  const { rateLimit: rateLimitFn, getClientIdentifier } = await import("@/lib/rate-limit");
  const limiter = rateLimitFn(getClientIdentifier(req), "share-video-status");
  if (!limiter.ok) {
    return Response.json(
      { error: "Too many requests", retryAfter: Math.ceil(limiter.resetIn / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limiter.resetIn / 1000)) } }
    );
  }

  if (!isConvexTrackingEnabled()) {
    return Response.json(
      {
        error:
          "Convex tracking is not configured. Set CONVEX_URL (and optional CONVEX_DEPLOY_KEY).",
      },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId")?.trim();
  if (!jobId) {
    return Response.json({ error: "Missing jobId" }, { status: 400 });
  }

  try {
    const job = await getShareVideoMirrorJobInConvex(jobId);
    if (!job) {
      return Response.json({ error: "Job not found" }, { status: 404 });
    }

    return Response.json({
      resultType: "shareVideoMirrorStatus" as const,
      job,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      {
        error: "Failed to query mirror job status",
        details: message,
      },
      { status: 502 }
    );
  }
}
