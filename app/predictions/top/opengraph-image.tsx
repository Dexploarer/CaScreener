import { ImageResponse } from "next/og";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px",
          background:
            "radial-gradient(circle at top left, #22c55e 0, #1e293b 45%, #020617 100%)",
          color: "#f9fafb",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
        }}
      >
        <div style={{ fontSize: 20, opacity: 0.8 }}>CaScreener • prediction markets</div>
        <div>
          <div style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.05 }}>
            Today&apos;s Wildest Arbs
          </div>
          <div style={{ marginTop: 16, fontSize: 24, maxWidth: 700, opacity: 0.9 }}>
            Live leaderboard of the biggest spreads between Polymarket &amp; Manifold – built on
            CaScreener + AI SDK.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 20,
            color: "#e5e7eb",
          }}
        >
          <span>📈 Top cross-exchange edges · 🔁 Auto-updating</span>
          <span style={{ fontWeight: 600 }}>/predictions/top</span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
