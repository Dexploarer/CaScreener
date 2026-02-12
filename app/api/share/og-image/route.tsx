import { ImageResponse } from "next/og";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const SIZE = {
  width: 1200,
  height: 630,
};

function q(url: URL, key: string, fallback = ""): string {
  const value = url.searchParams.get(key)?.trim();
  return value && value.length > 0 ? value : fallback;
}

function qNum(url: URL, key: string, fallback: number): number {
  const value = Number(url.searchParams.get(key));
  if (!Number.isFinite(value)) return fallback;
  return value;
}

function truncate(value: string, max = 72): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function scoreColor(score: number): string {
  if (score >= 80) return "#34d399";
  if (score >= 65) return "#a3e635";
  if (score >= 45) return "#fbbf24";
  if (score >= 30) return "#fb923c";
  return "#f87171";
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);

  const symbol = q(url, "symbol", "TOKEN").toUpperCase();
  const name = q(url, "name", "Meme Token Trust Scan");
  const mint = q(url, "mint", "unknown-mint");
  const grade = q(url, "grade", "N/A");
  const pair = q(url, "pair", "");
  const image = q(url, "image", "");
  const summary = q(url, "summary", "Clone risk and trust score snapshot");

  const score = Math.max(0, Math.min(100, Math.round(qNum(url, "score", 0))));
  const suspicious = Math.max(0, Math.round(qNum(url, "suspicious", 0)));
  const total = Math.max(0, Math.round(qNum(url, "total", 0)));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "40px",
          background:
            "linear-gradient(135deg, #03131f 0%, #0b1020 35%, #111827 65%, #1f2937 100%)",
          color: "#f8fafc",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 18, opacity: 0.8 }}>Meme Token Trust Score</span>
            <span style={{ marginTop: 4, fontSize: 46, fontWeight: 800, letterSpacing: -1 }}>
              {truncate(symbol, 20)}
            </span>
            <span style={{ marginTop: 6, fontSize: 24, opacity: 0.9 }}>{truncate(name, 42)}</span>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              width: 220,
              height: 220,
              borderRadius: 999,
              border: `8px solid ${scoreColor(score)}`,
              background: "rgba(15, 23, 42, 0.8)",
            }}
          >
            <span style={{ fontSize: 72, fontWeight: 800, color: scoreColor(score), lineHeight: 1 }}>
              {score}
            </span>
            <span style={{ marginTop: 4, fontSize: 20, opacity: 0.85 }}>Grade {grade}</span>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 24 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              padding: "20px 24px",
              borderRadius: 18,
              border: "1px solid rgba(148, 163, 184, 0.35)",
              background: "rgba(2, 6, 23, 0.55)",
            }}
          >
            <span style={{ fontSize: 20, opacity: 0.9 }}>Suspicious Clones</span>
            <span style={{ marginTop: 6, fontSize: 40, fontWeight: 700 }}>
              {suspicious} / {total}
            </span>
            <span style={{ marginTop: 8, fontSize: 18, opacity: 0.8 }}>{truncate(summary, 96)}</span>
          </div>

          {image ? (
            <img
              src={image}
              alt={symbol}
              style={{
                width: 220,
                height: 220,
                borderRadius: 18,
                border: "1px solid rgba(148, 163, 184, 0.45)",
                objectFit: "cover",
                background: "#0f172a",
              }}
            />
          ) : (
            <div
              style={{
                width: 220,
                height: 220,
                borderRadius: 18,
                border: "1px dashed rgba(148, 163, 184, 0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#94a3b8",
                fontSize: 16,
              }}
            >
              No token image
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 18,
            fontSize: 16,
            color: "#cbd5e1",
          }}
        >
          <span style={{ maxWidth: 700, overflow: "hidden", textOverflow: "ellipsis" }}>
            Mint: {mint}
          </span>
          <span>Compliments of @dEXploarer</span>
        </div>
      </div>
    ),
    {
      ...SIZE,
    }
  );
}
