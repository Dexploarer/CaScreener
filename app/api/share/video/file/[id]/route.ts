import { promises as fs } from "node:fs";
import path from "node:path";
import { getRenderedVideoFilePath } from "@/lib/media/remotion-video-render";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function toDownloadName(filePath: string): string {
  return path.basename(filePath);
}

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  const { rateLimit: rateLimitFn, getClientIdentifier } = await import("@/lib/rate-limit");
  const limiter = rateLimitFn(getClientIdentifier(req), "share-video-file");
  if (!limiter.ok) {
    return Response.json(
      { error: "Too many requests", retryAfter: Math.ceil(limiter.resetIn / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limiter.resetIn / 1000)) } }
    );
  }

  const { id } = await context.params;
  const filePath = await getRenderedVideoFilePath(id);
  if (!filePath) {
    return Response.json({ error: "Video file not found" }, { status: 404 });
  }

  try {
    const data = await fs.readFile(filePath);
    const stats = await fs.stat(filePath);
    const download = new URL(req.url).searchParams.get("download") === "1";
    const dispositionType = download ? "attachment" : "inline";

    return new Response(data, {
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "public, max-age=3600",
        "Content-Length": String(stats.size),
        "Content-Disposition": `${dispositionType}; filename=\"${toDownloadName(filePath)}\"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { error: "Failed to read rendered video", details: message },
      { status: 500 }
    );
  }
}
