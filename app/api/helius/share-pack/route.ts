import { buildSharePackOgImageUrl, buildTokenSharePack } from "@/lib/helius/share-pack";
import { computeTokenTrustScore } from "@/lib/helius/trust-score";
import type { TokenLookupResult } from "@/lib/helius/types";

type SharePackBody = {
  token?: TokenLookupResult;
};

function isTokenResult(value: unknown): value is TokenLookupResult {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return obj.resultType === "token" && typeof obj.id === "string";
}

export async function POST(req: Request): Promise<Response> {
  const { rateLimit: rateLimitFn, getClientIdentifier } = await import("@/lib/rate-limit");
  const limiter = rateLimitFn(getClientIdentifier(req), "helius-share-pack");
  if (!limiter.ok) {
    return Response.json(
      { error: "Too many requests", retryAfter: Math.ceil(limiter.resetIn / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limiter.resetIn / 1000)) } }
    );
  }

  let body: SharePackBody;
  try {
    body = (await req.json()) as SharePackBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isTokenResult(body.token)) {
    return Response.json({ error: "Missing token result payload" }, { status: 400 });
  }

  const token = body.token;
  const trust = token.trustScore ?? computeTokenTrustScore(token);
  const sharePack = buildTokenSharePack(token, trust);
  const origin = new URL(req.url).origin;
  const imageUrl = buildSharePackOgImageUrl(origin, token, trust, sharePack.summary);
  return Response.json({
    resultType: "tokenSharePack" as const,
    tokenId: token.id,
    tokenSymbol: token.symbol,
    trustScore: trust,
    ...sharePack,
    imageCard: {
      ...sharePack.imageCard,
      imageUrl,
    },
    video: {
      renderEndpoint: `${origin}/api/share/video`,
    },
  });
}
