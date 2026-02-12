import { getPumpSnapshot } from "@/lib/market-data/pumpportal";
import { buildPumpMediaBundle } from "@/lib/media/pump-remotion";

export const maxDuration = 60;

type MediaFormat = "bundle" | "video" | "screenshots" | "prompts" | "snapshot";

function parseFormat(value: unknown): MediaFormat {
  if (typeof value !== "string") return "bundle";
  const v = value.trim().toLowerCase();
  if (v === "video" || v === "screenshots" || v === "prompts" || v === "snapshot") {
    return v;
  }
  return "bundle";
}

async function handleRequest(req: Request) {
  const { rateLimit: rateLimitFn, getClientIdentifier } = await import("@/lib/rate-limit");
  const limiter = rateLimitFn(getClientIdentifier(req), "pump-media");
  if (!limiter.ok) {
    return Response.json(
      {
        error: "Too many requests",
        retryAfter: Math.ceil(limiter.resetIn / 1000),
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(limiter.resetIn / 1000)),
        },
      }
    );
  }

  let body: { prompt?: string; format?: string } = {};
  if (req.method === "POST") {
    body = await req.json().catch(() => ({}));
  }

  const url = new URL(req.url);
  const promptRaw =
    (typeof body.prompt === "string" ? body.prompt : "") ||
    url.searchParams.get("prompt") ||
    "";
  const prompt = promptRaw.trim();
  const format = parseFormat(
    (typeof body.format === "string" ? body.format : "") ||
      url.searchParams.get("format") ||
      "bundle"
  );

  try {
    const snapshot = await getPumpSnapshot();
    const bundle = buildPumpMediaBundle(snapshot, prompt);

    if (format === "video") {
      return Response.json({
        generatedAt: new Date().toISOString(),
        source: "PumpPortal",
        recap: bundle.recap,
        timeline: bundle.timeline,
      });
    }

    if (format === "screenshots") {
      return Response.json({
        generatedAt: new Date().toISOString(),
        source: "PumpPortal",
        recap: bundle.recap,
        screenshotPlan: bundle.screenshotPlan,
      });
    }

    if (format === "prompts") {
      return Response.json({
        generatedAt: new Date().toISOString(),
        source: "PumpPortal",
        recap: bundle.recap,
        promptTemplates: bundle.promptTemplates,
      });
    }

    if (format === "snapshot") {
      return Response.json({
        generatedAt: new Date().toISOString(),
        source: "PumpPortal",
        snapshot,
      });
    }

    return Response.json({
      generatedAt: new Date().toISOString(),
      source: "PumpPortal",
      ...bundle,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { error: "Failed to build Pump media bundle", details: message },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  return handleRequest(req);
}

export async function POST(req: Request) {
  return handleRequest(req);
}
