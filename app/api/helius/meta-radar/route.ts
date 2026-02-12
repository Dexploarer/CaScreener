import {
  getMetaRadarClustersInConvex,
  isConvexTrackingEnabled,
} from "@/lib/meme-meta/convex-rag";

type MetaRadarBody = {
  limit?: number;
  windowMs?: number;
};

export async function POST(req: Request): Promise<Response> {
  const { rateLimit: rateLimitFn, getClientIdentifier } = await import("@/lib/rate-limit");
  const limiter = rateLimitFn(getClientIdentifier(req), "helius-meta-radar");
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

  let body: MetaRadarBody = {};
  try {
    body = (await req.json()) as MetaRadarBody;
  } catch {
    body = {};
  }

  try {
    const clusters = await getMetaRadarClustersInConvex({
      limit: body.limit,
      windowMs: body.windowMs,
    });
    return Response.json({
      resultType: "metaRadar" as const,
      generatedAt: new Date().toISOString(),
      clusters,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: "Meta radar query failed", details: message },
      { status: 502 }
    );
  }
}
