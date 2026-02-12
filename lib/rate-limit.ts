/**
 * In-memory rate limiter (sliding window). Suitable for single-instance / demo.
 * For production with multiple instances, use Redis (e.g. @upstash/ratelimit).
 */

const windowMs = 60 * 1000; // 1 minute
const maxRequests = 20; // per window per key

const store = new Map<string, { count: number; resetAt: number }>();

function shouldBypassRateLimit(): boolean {
  if (process.env.DISABLE_RATE_LIMIT === "1") return true;
  if (process.env.DISABLE_RATE_LIMIT === "true") return true;
  return process.env.NODE_ENV !== "production";
}

function getKey(identifier: string, prefix: string): string {
  return `${prefix}:${identifier}`;
}

function prune(key: string, now: number): void {
  const entry = store.get(key);
  if (entry && now >= entry.resetAt) store.delete(key);
}

export function rateLimit(identifier: string, prefix: string = "api"): { ok: boolean; remaining: number; resetIn: number } {
  if (shouldBypassRateLimit()) {
    return {
      ok: true,
      remaining: Number.MAX_SAFE_INTEGER,
      resetIn: 0,
    };
  }

  const now = Date.now();
  const key = getKey(identifier, prefix);
  prune(key, now);

  let entry = store.get(key);
  if (!entry) {
    entry = { count: 1, resetAt: now + windowMs };
    store.set(key, entry);
    return { ok: true, remaining: maxRequests - 1, resetIn: windowMs };
  }

  if (entry.count >= maxRequests) {
    return {
      ok: false,
      remaining: 0,
      resetIn: Math.max(0, entry.resetAt - now),
    };
  }

  entry.count += 1;
  return {
    ok: true,
    remaining: maxRequests - entry.count,
    resetIn: Math.max(0, entry.resetAt - now),
  };
}

export function getClientIdentifier(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const ip = forwarded?.split(",")[0]?.trim() || realIp || "unknown";
  return ip;
}
