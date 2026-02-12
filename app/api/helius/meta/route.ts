import {
  isConvexTrackingEnabled,
  searchTokenNarrativesInConvex,
} from "@/lib/meme-meta/convex-rag";

type SearchBody = {
  query?: string;
  symbol?: string;
  mint?: string;
  limit?: number;
  namespace?: string;
  vectorScoreThreshold?: number;
};

export async function POST(req: Request): Promise<Response> {
  const { rateLimit: rateLimitFn, getClientIdentifier } = await import("@/lib/rate-limit");
  const limiter = rateLimitFn(getClientIdentifier(req), "helius-meta-rag");
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

  let body: SearchBody;
  try {
    body = (await req.json()) as SearchBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = body.query?.trim();
  if (!query) {
    return Response.json({ error: "Missing query" }, { status: 400 });
  }

  try {
    const result = await searchTokenNarrativesInConvex({
      query,
      symbol: body.symbol?.trim(),
      mint: body.mint?.trim(),
      namespace: body.namespace?.trim(),
      limit: body.limit,
      vectorScoreThreshold: body.vectorScoreThreshold,
    });
    return Response.json({
      resultType: "tokenMetaRag" as const,
      ...result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: "Convex RAG query failed", details: message },
      { status: 502 }
    );
  }
}
