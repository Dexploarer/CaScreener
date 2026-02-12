import type { TimelineSpec } from "@json-render/remotion";
import { buildTokenSharePack } from "@/lib/helius/share-pack";
import { computeTokenTrustScore } from "@/lib/helius/trust-score";
import type { TokenLookupResult } from "@/lib/helius/types";
import { renderTimelineSpecToMp4 } from "@/lib/media/remotion-video-render";
import {
  enqueueShareVideoMirrorInConvex,
  isConvexTrackingEnabled,
} from "@/lib/meme-meta/convex-rag";

export const runtime = "nodejs";
export const maxDuration = 120;

type RenderVideoBody = {
  token?: TokenLookupResult;
  timeline?: TimelineSpec;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isTokenResult(value: unknown): value is TokenLookupResult {
  if (!isRecord(value)) return false;
  return value.resultType === "token" && typeof value.id === "string";
}

function isTimelineSpec(value: unknown): value is TimelineSpec {
  if (!isRecord(value)) return false;
  const composition = isRecord(value.composition) ? value.composition : null;
  return (
    !!composition &&
    typeof composition.fps === "number" &&
    typeof composition.width === "number" &&
    typeof composition.height === "number" &&
    typeof composition.durationInFrames === "number"
  );
}

export async function POST(req: Request): Promise<Response> {
  const { rateLimit: rateLimitFn, getClientIdentifier } = await import("@/lib/rate-limit");
  const limiter = rateLimitFn(getClientIdentifier(req), "share-video-render");
  if (!limiter.ok) {
    return Response.json(
      { error: "Too many requests", retryAfter: Math.ceil(limiter.resetIn / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limiter.resetIn / 1000)) } }
    );
  }

  let body: RenderVideoBody;
  try {
    body = (await req.json()) as RenderVideoBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let timeline: TimelineSpec | null = null;
  let tokenId: string | undefined;
  let tokenSymbol: string | undefined;

  if (body.token && isTokenResult(body.token)) {
    const trust = body.token.trustScore ?? computeTokenTrustScore(body.token);
    const sharePack = buildTokenSharePack(body.token, trust);
    timeline = sharePack.hypeVideo.timeline;
    tokenId = body.token.id;
    tokenSymbol = body.token.symbol;
  } else if (body.timeline && isTimelineSpec(body.timeline)) {
    timeline = body.timeline;
  }

  if (!timeline) {
    return Response.json(
      { error: "Missing token payload or valid timeline spec" },
      { status: 400 }
    );
  }

  const startedAt = Date.now();
  try {
    const rendered = await renderTimelineSpecToMp4(timeline);
    const elapsedMs = Date.now() - startedAt;
    const origin = new URL(req.url).origin;
    const previewUrl = `${origin}/api/share/video/file/${rendered.id}`;
    const downloadUrl = `${origin}/api/share/video/file/${rendered.id}?download=1`;

    const convexMirror: {
      enabled: boolean;
      jobId?: string;
      status?: string;
      statusUrl?: string;
      error?: string;
    } = {
      enabled: isConvexTrackingEnabled(),
    };

    if (convexMirror.enabled) {
      try {
        const mirrorJob = await enqueueShareVideoMirrorInConvex({
          sourceUrl: previewUrl,
          tokenId,
          tokenSymbol,
          requestedBy: tokenId || tokenSymbol || undefined,
        });
        convexMirror.jobId = mirrorJob.jobId;
        convexMirror.status = mirrorJob.status;
        convexMirror.statusUrl = `${origin}/api/share/video/status?jobId=${encodeURIComponent(mirrorJob.jobId)}`;
      } catch (mirrorError) {
        convexMirror.error =
          mirrorError instanceof Error ? mirrorError.message : String(mirrorError);
      }
    }

    return Response.json({
      resultType: "shareVideo" as const,
      tokenId,
      tokenSymbol,
      videoId: rendered.id,
      reusedCache: rendered.reusedCache,
      renderMs: elapsedMs,
      durationInFrames: rendered.durationInFrames,
      fps: rendered.fps,
      width: rendered.width,
      height: rendered.height,
      sizeBytes: rendered.sizeBytes,
      downloadUrl,
      previewUrl,
      convexMirror,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      {
        error: "Failed to render share video",
        details: message,
      },
      { status: 500 }
    );
  }
}
