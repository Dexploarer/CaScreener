import { NextRequest } from "next/server";
import { rateLimit, getClientIdentifier } from "@/lib/rate-limit";
import type { PredictionMarket } from "@/lib/predictions/types";
import { getTrendingMarkets as getPolyTrending } from "@/lib/predictions/polymarket";
import { getTrendingMarkets as getManiTrending } from "@/lib/predictions/manifold";
import { findArbitrageOpportunities } from "@/lib/predictions/arbitrage";

type Body = {
  minSpread?: number;
  limit?: number;
};

export async function POST(req: NextRequest): Promise<Response> {
  const id = getClientIdentifier(req as unknown as Request);
  const limiter = rateLimit(id, "predictions-arbitrage");
  if (!limiter.ok) {
    const retryAfter = Math.ceil(limiter.resetIn / 1000);
    return Response.json(
      { error: "Too many requests", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const minSpread = typeof body.minSpread === "number" ? body.minSpread : 0.01;
  const limit = typeof body.limit === "number" ? body.limit : 50;

  let poly: PredictionMarket[] = [];
  let mani: PredictionMarket[] = [];

  try {
    const [p, m] = await Promise.all([
      getPolyTrending(100).catch(() => []),
      getManiTrending(100).catch(() => []),
    ]);
    poly = p;
    mani = m;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: "Failed to fetch markets for arbitrage", details: message },
      { status: 502 }
    );
  }

  const opportunities = findArbitrageOpportunities(poly, mani, {
    minSimilarity: 0.8,
    minSpread,
  }).slice(0, limit);

  return Response.json({ opportunities });
}

