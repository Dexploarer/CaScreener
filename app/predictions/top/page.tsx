"use client";

import { useEffect, useState } from "react";
import type { ArbitrageOpportunity } from "@/lib/predictions/types";

function formatPercent(p: number | undefined): string {
  if (p == null || Number.isNaN(p)) return "–";
  return `${(p * 100).toFixed(2)}%`;
}

export default function TopArbsPage() {
  const [opportunities, setOpportunities] = useState<ArbitrageOpportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/predictions/arbitrage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minSpread: 0.03, limit: 25 }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "Failed to load arbitrage leaderboard");
          return;
        }
        setOpportunities(json.opportunities ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, []);

  const copyTopArbsThread = () => {
    if (opportunities.length === 0) return;
    const top = opportunities.slice(0, 5);
    const lines: string[] = [];
    lines.push("1/4 Cross-platform prediction market arbitrage – today’s biggest spreads:");
    top.forEach((o, idx) => {
      const profit = o.impliedProfit != null ? (o.impliedProfit * 100).toFixed(2) : "—";
      lines.push(
        "",
        `${idx + 1}. ${o.question}`,
        `Implied edge (before fees/slippage): ${profit}%`
      );
    });
    lines.push(
      "",
      "2/4 These are informational only – not investment advice.",
      "Execution risk includes liquidity, slippage, fills, platform risk, and regulation."
    );
    lines.push(
      "",
      "3/4 Strategy usually means buying cheaper YES on one venue and hedging with NO on the other."
    );
    const link =
      typeof window !== "undefined"
        ? `${window.location.origin}/predictions/top`
        : "/predictions/top";
    lines.push(
      "",
      `4/4 See live tables & dashboards here: ${link}`
    );
    navigator.clipboard.writeText(lines.join("\n"));
  };

  return (
    <main className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-zinc-100 mb-2">
        Top Prediction Market Arbitrage
      </h1>
      <p className="text-zinc-400 mb-4">
        Biggest cross-platform spreads between Polymarket and Manifold, filtered to opportunities with at least ~3%
        theoretical edge before fees and slippage.
      </p>
      <div className="flex flex-wrap gap-2 mb-4">
        <a
          href="/predictions"
          className="px-3 py-1.5 text-sm border border-zinc-600 hover:bg-zinc-800 text-zinc-300 rounded-lg"
        >
          ← Back to predictions
        </a>
        <button
          type="button"
          onClick={copyTopArbsThread}
          disabled={opportunities.length === 0}
          className="px-3 py-1.5 text-sm border border-zinc-600 hover:bg-zinc-800 text-zinc-300 rounded-lg disabled:opacity-50"
        >
          Copy social thread
        </button>
      </div>
      <div className="min-h-[1.5rem] text-sm text-red-400">
        {error && <span>{error}</span>}
      </div>
      {loading && opportunities.length === 0 && (
        <p className="text-zinc-500 text-sm">Scanning markets for top arbitrage opportunities…</p>
      )}
      {!loading && opportunities.length === 0 && !error && (
        <p className="text-zinc-500 text-sm">
          No strong cross-platform opportunities over 3% detected right now. Try again later.
        </p>
      )}
      {opportunities.length > 0 && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 overflow-hidden mt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900">
                <tr className="border-b border-zinc-700 text-left text-zinc-400">
                  <th className="p-3 font-medium">#</th>
                  <th className="p-3 font-medium">Question</th>
                  <th className="p-3 font-medium">Best YES</th>
                  <th className="p-3 font-medium">Best NO</th>
                  <th className="p-3 font-medium">Implied profit</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((o, idx) => (
                  <tr
                    key={`${idx}-${o.question}`}
                    className="border-b border-zinc-800 hover:bg-zinc-800/40"
                  >
                    <td className="p-3 align-top text-xs text-zinc-500">{idx + 1}</td>
                    <td className="p-3 align-top text-zinc-100 max-w-md">
                      <div className="line-clamp-3">{o.question}</div>
                    </td>
                    <td className="p-3 align-top text-xs text-emerald-300">
                      {o.bestYesBuy ? (
                        <>
                          <span className="font-mono text-[0.7rem] px-1.5 py-0.5 rounded bg-zinc-800 mr-1">
                            {o.bestYesBuy.market.platform}
                          </span>
                          {formatPercent(o.bestYesBuy.price)}
                        </>
                      ) : (
                        "–"
                      )}
                    </td>
                    <td className="p-3 align-top text-xs text-emerald-300">
                      {o.bestNoBuy ? (
                        <>
                          <span className="font-mono text-[0.7rem] px-1.5 py-0.5 rounded bg-zinc-800 mr-1">
                            {o.bestNoBuy.market.platform}
                          </span>
                          {formatPercent(o.bestNoBuy.price)}
                        </>
                      ) : (
                        "–"
                      )}
                    </td>
                    <td className="p-3 align-top text-xs text-zinc-100">
                      {o.impliedProfit != null ? formatPercent(o.impliedProfit) : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

