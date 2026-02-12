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
            "radial-gradient(circle at top left, #22c55e 0, #18181b 45%, #020617 100%)",
          color: "#f9fafb",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
        }}
      >
        <div style={{ fontSize: 20, opacity: 0.8 }}>Tickergeist</div>
        <div>
          <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.05 }}>
            Prediction Markets &amp; AI Dashboards
          </div>
          <div style={{ marginTop: 16, fontSize: 24, maxWidth: 700, opacity: 0.9 }}>
            Scan Polymarket &amp; Manifold for cross-platform arbitrage, then let AI build
            shareable dashboards and meme-ready threads in one click.
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
          <span>🔮 Markets · 📈 Arbs · 🤖 Dashboards · 🔥 Memes</span>
          <span style={{ fontWeight: 600 }}>/predictions</span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
