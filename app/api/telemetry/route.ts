import {
  getTelemetrySummaryInConvex,
  isConvexTrackingEnabled,
  trackTelemetryInConvex,
} from "@/lib/meme-meta/convex-rag";

type TelemetryBody = {
  event?: string;
  userId?: string;
  sessionId?: string;
  page?: string;
  properties?: Record<string, unknown>;
};

const localCounts = new Map<string, number>();

export async function POST(req: Request): Promise<Response> {
  const { rateLimit: rateLimitFn, getClientIdentifier } = await import("@/lib/rate-limit");
  const limiter = rateLimitFn(getClientIdentifier(req), "telemetry");
  if (!limiter.ok) {
    return Response.json(
      { error: "Too many requests", retryAfter: Math.ceil(limiter.resetIn / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limiter.resetIn / 1000)) } }
    );
  }

  let body: TelemetryBody;
  try {
    body = (await req.json()) as TelemetryBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const event = body.event?.trim();
  if (!event) {
    return Response.json({ error: "Missing event" }, { status: 400 });
  }

  localCounts.set(event, (localCounts.get(event) ?? 0) + 1);

  let storedRemotely = false;
  if (isConvexTrackingEnabled()) {
    try {
      storedRemotely = await trackTelemetryInConvex({
        event,
        userId: body.userId?.trim() || undefined,
        sessionId: body.sessionId?.trim() || undefined,
        page: body.page?.trim() || undefined,
        properties: body.properties,
      });
    } catch {
      storedRemotely = false;
    }
  }

  return Response.json({
    ok: true,
    event,
    localCount: localCounts.get(event) ?? 1,
    storedRemotely,
  });
}

export async function GET(req: Request): Promise<Response> {
  const { rateLimit: rateLimitFn, getClientIdentifier } = await import("@/lib/rate-limit");
  const limiter = rateLimitFn(getClientIdentifier(req), "telemetry-summary");
  if (!limiter.ok) {
    return Response.json(
      { error: "Too many requests", retryAfter: Math.ceil(limiter.resetIn / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limiter.resetIn / 1000)) } }
    );
  }

  const url = new URL(req.url);
  const windowMs = Number(url.searchParams.get("windowMs") || 1000 * 60 * 60 * 24);
  const local = [...localCounts.entries()]
    .map(([event, count]) => ({ event, count }))
    .sort((a, b) => b.count - a.count);

  if (!isConvexTrackingEnabled()) {
    return Response.json({
      source: "local-memory",
      summary: local,
    });
  }

  try {
    const remote = await getTelemetrySummaryInConvex(windowMs);
    return Response.json({
      source: "convex",
      summary: remote,
      localFallback: local,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({
      source: "local-memory",
      summary: local,
      warning: message,
    });
  }
}
