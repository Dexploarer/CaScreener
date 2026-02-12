import { buildWalletAnalytics } from "@/lib/helius/analytics";
import { isValidSolanaAddress } from "@/lib/helius/validation";

export type WalletAnalytics = Awaited<ReturnType<typeof buildWalletAnalytics>> & { error?: string };

export async function POST(req: Request): Promise<Response> {
  const { rateLimit: rateLimitFn, getClientIdentifier } = await import("@/lib/rate-limit");
  const limiter = rateLimitFn(getClientIdentifier(req), "helius-analytics");
  if (!limiter.ok) {
    return Response.json(
      { error: "Too many requests", retryAfter: Math.ceil(limiter.resetIn / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limiter.resetIn / 1000)) } }
    );
  }

  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "HELIUS_API_KEY is not set. Add it in .env.local and get a key at https://dashboard.helius.dev" },
      { status: 503 }
    );
  }

  let body: { address?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawAddress = body.address?.trim();
  if (!rawAddress) {
    return Response.json({ error: "Missing address" }, { status: 400 });
  }
  if (!isValidSolanaAddress(rawAddress)) {
    return Response.json({ error: "Invalid Solana address" }, { status: 400 });
  }

  try {
    const analytics = await buildWalletAnalytics(apiKey, rawAddress);
    return Response.json(analytics);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: "Helius request failed", details: message },
      { status: 502 }
    );
  }
}
