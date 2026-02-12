import {
  isConvexTrackingEnabled,
  listWatchAlertsInConvex,
  listWatchlistInConvex,
  subscribeWatchlistInConvex,
  unsubscribeWatchlistInConvex,
} from "@/lib/meme-meta/convex-rag";

type WatchlistBody = {
  action?: "list" | "subscribe" | "unsubscribe" | "alerts";
  userId?: string;
  ticker?: string;
  mint?: string;
  channels?: {
    web?: boolean;
    telegramChatId?: string;
    discordWebhookUrl?: string;
  };
  limit?: number;
};

export async function POST(req: Request): Promise<Response> {
  const { rateLimit: rateLimitFn, getClientIdentifier } = await import("@/lib/rate-limit");
  const limiter = rateLimitFn(getClientIdentifier(req), "helius-watchlist");
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

  let body: WatchlistBody;
  try {
    body = (await req.json()) as WatchlistBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action ?? "list";
  const userId = body.userId?.trim();
  if (!userId) {
    return Response.json({ error: "Missing userId" }, { status: 400 });
  }

  try {
    if (action === "list") {
      const items = await listWatchlistInConvex(userId);
      return Response.json({ resultType: "watchlist", items });
    }
    if (action === "alerts") {
      const alerts = await listWatchAlertsInConvex(userId, body.limit ?? 20);
      return Response.json({ resultType: "watchAlerts", alerts });
    }
    if (action === "unsubscribe") {
      if (!body.ticker?.trim()) {
        return Response.json({ error: "Missing ticker" }, { status: 400 });
      }
      const ok = await unsubscribeWatchlistInConvex({
        userId,
        ticker: body.ticker,
      });
      return Response.json({ resultType: "watchlist", ok });
    }
    if (action === "subscribe") {
      if (!body.ticker?.trim()) {
        return Response.json({ error: "Missing ticker" }, { status: 400 });
      }
      const item = await subscribeWatchlistInConvex({
        userId,
        ticker: body.ticker,
        mint: body.mint?.trim(),
        channels: body.channels,
      });
      return Response.json({ resultType: "watchlist", item });
    }
    return Response.json({ error: "Invalid action" }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: "Watchlist request failed", details: message },
      { status: 502 }
    );
  }
}
