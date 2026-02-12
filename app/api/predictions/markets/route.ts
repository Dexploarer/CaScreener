import { NextRequest } from "next/server";
import { rateLimit, getClientIdentifier } from "@/lib/rate-limit";
import type { PredictionMarket } from "@/lib/predictions/types";
import { searchMarkets as searchPoly } from "@/lib/predictions/polymarket";
import { searchMarkets as searchMani } from "@/lib/predictions/manifold";

type Body = {
  query?: string;
  platform?: "polymarket" | "manifold" | "all";
  limit?: number;
};

export async function POST(req: NextRequest): Promise<Response> {
  const id = getClientIdentifier(req as unknown as Request);
  const limiter = rateLimit(id, "predictions-markets");
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

  const query = typeof body.query === "string" ? body.query.trim() : "";
  const platform = body.platform ?? "all";
  const limit = typeof body.limit === "number" ? body.limit : 50;

  const tasks: Promise<PredictionMarket[]>[] = [];
  if (platform === "all" || platform === "polymarket") {
    tasks.push(
      searchPoly({ query, limit }).catch(() => [])
    );
  }
  if (platform === "all" || platform === "manifold") {
    tasks.push(
      searchMani({ query, limit }).catch(() => [])
    );
  }

  let markets: PredictionMarket[] = [];
  try {
    const results = await Promise.all(tasks);
    markets = results.flat();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: "Failed to fetch prediction markets", details: message },
      { status: 502 }
    );
  }

  // basic sort: highest 24h volume then total volume desc
  markets.sort(
    (a, b) =>
      (b.volume24h ?? 0) - (a.volume24h ?? 0) ||
      (b.volume ?? 0) - (a.volume ?? 0)
  );

  return Response.json({ markets });
}

