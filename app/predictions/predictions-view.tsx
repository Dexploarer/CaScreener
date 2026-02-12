"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Renderer,
  StateProvider,
  ActionProvider,
  VisibilityProvider,
  ValidationProvider,
} from "@json-render/react";
import { registry } from "@/lib/registry";
import type { PredictionsState } from "./use-predictions";
import type { ArbitrageOpportunity } from "@/lib/predictions/types";
import { toSpec, initialData, validators } from "./utils";

function formatPercent(p: number | undefined): string {
  if (p == null || Number.isNaN(p)) return "–";
  return `${(p * 100).toFixed(1)}%`;
}

const SUGGESTED_FILTERS = [
  { query: "Bitcoin", label: "BTC" },
  { query: "Ethereum", label: "ETH" },
  { query: "Trump", label: "Politics" },
  { query: "election", label: "Election" },
  { query: "NVIDIA", label: "Tech" },
  { query: "Fed", label: "Fed" },
];

const FOLLOW_UP_CHIPS = [
  "Only politics markets",
  "Focus on arbitrage opportunities",
  "Top 5 highest implied profit",
  "Crypto markets only",
  "Markets closing this week",
];

function getArbLabels(o: ArbitrageOpportunity): string[] {
  const labels: string[] = [];
  const minLiq = 5000;
  const bigSpread = 0.05;
  const daysToClose = 7;
  const totalLiq = o.markets.reduce((s, m) => s + (m.liquidity ?? m.volume ?? 0), 0);
  if (totalLiq < minLiq) labels.push("thin liquidity");
  if ((o.impliedProfit ?? 0) > bigSpread) labels.push("big spread");
  const soonest = o.markets
    .map((m) => (m.endDate ? new Date(m.endDate).getTime() : Infinity))
    .filter((t) => t < Infinity);
  if (soonest.length > 0) {
    const min = Math.min(...soonest);
    const days = (min - Date.now()) / (24 * 60 * 60 * 1000);
    if (days < daysToClose && days > 0) labels.push("time-sensitive");
  }
  return labels;
}

export function PredictionsView(props: PredictionsState) {
  const {
    activeTab,
    setActiveTab,
    platform,
    setPlatform,
    degenMode,
    setDegenMode,
    query,
    setQuery,
    loadingMarkets,
    marketsError,
    markets,
    loadMarkets,
    loadingArb,
    arbError,
    opportunities,
    loadArbitrage,
    chatMessages,
    chatInput,
    setChatInput,
    sending,
    sendMessage,
    sendMessageWithContext,
    ugiSpec,
    ugiStreaming,
    ugiError,
    ugiProvider,
    onUgiProviderChange,
    copyFeedback,
    followUpPrompt,
    setFollowUpPrompt,
    generateUgiDashboard,
    copySpecJson,
    copySummary,
    copyMarketsSummary,
    copyArbitrageSummary,
    copyChatAnswer,
    copyExportCode,
    requestViewUpdate,
    getActionHandlers,
    saveDashboard,
    restoreSavedDashboard,
    copyDashboardLink,
    canRestoreSaved,
    savedViews,
    saveCurrentView,
    applySavedView,
    deleteSavedView,
    copyArbitrageThread,
    memeCaptions,
    memeLoading,
    memeError,
    generateMemeCaptionsForArb,
    clearMemeCaptions,
    copyMemeCaption,
  } = props;

  const [selectedArb, setSelectedArb] = useState<ArbitrageOpportunity | null>(null);
  const [viewName, setViewName] = useState("");

  return (
    <main className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-zinc-100 mb-2">Prediction Markets</h1>
      <p className="text-zinc-400 mb-4">
        Explore markets from Polymarket and Manifold, scan for cross-platform arbitrage, and ask an AI agent for
        follow-up analysis.
      </p>

      <section className="mb-6 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            placeholder="Name this view (e.g. US election, AI plays)"
            className="flex-1 min-w-[200px] border border-zinc-700 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="button"
            onClick={() => {
              if (!viewName.trim()) return;
              saveCurrentView(viewName);
              setViewName("");
            }}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium disabled:opacity-50"
            disabled={!viewName.trim()}
          >
            Save view
          </button>
          <a
            href="/predictions/top"
            className="text-xs text-violet-300 hover:text-violet-100 underline-offset-2 hover:underline"
          >
            View today&apos;s top arbs →
          </a>
        </div>
        {savedViews.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {savedViews.map((v) => (
              <div
                key={v.id}
                className="flex items-center gap-1 px-2 py-1 rounded-full border border-zinc-700 bg-zinc-900/60"
              >
                <button
                  type="button"
                  onClick={() => applySavedView(v.id)}
                  className="text-zinc-200 hover:text-emerald-300"
                  title={`Apply view: ${v.name}`}
                >
                  {v.name}
                </button>
                <button
                  type="button"
                  onClick={() => deleteSavedView(v.id)}
                  className="text-zinc-500 hover:text-red-400 ml-1"
                  aria-label={`Delete view ${v.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-zinc-800 pb-2">
        {[
          { id: "markets", label: "Markets" },
          { id: "arbitrage", label: "Arbitrage" },
          { id: "chat", label: "Chat" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as "markets" | "arbitrage" | "chat")}
            className={`px-3 py-1.5 text-sm rounded-lg ${
              activeTab === tab.id
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "markets" && (
        <section aria-label="Prediction markets" className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  loadMarkets();
                }
              }}
              placeholder="Search questions (e.g. US election, BTC above 100k)"
              className="flex-1 min-w-[240px] border border-zinc-700 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as "all" | "polymarket" | "manifold")}
              className="border border-zinc-700 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="all">All platforms</option>
              <option value="polymarket">Polymarket</option>
              <option value="manifold">Manifold</option>
            </select>
            <button
              type="button"
              onClick={() => loadMarkets()}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50"
              disabled={loadingMarkets}
            >
              {loadingMarkets ? "Loading…" : "Search"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_FILTERS.map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => {
                  setQuery(f.query);
                  loadMarkets(f.query);
                }}
                className="px-3 py-1 text-xs rounded-full border border-zinc-600 hover:bg-zinc-800 text-zinc-300"
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyMarketsSummary}
              disabled={markets.length === 0}
              className="px-3 py-1.5 text-sm border border-zinc-600 hover:bg-zinc-800 text-zinc-300 rounded-lg disabled:opacity-50"
            >
              {copyFeedback === "markets" ? "Copied!" : "Copy markets summary"}
            </button>
          </div>
          <div className="min-h-[1.5rem] text-sm text-red-400">
            {marketsError && <span>{marketsError}</span>}
          </div>

          {loadingMarkets && markets.length === 0 && (
            <p className="text-zinc-500 text-sm">Loading markets…</p>
          )}

          {!loadingMarkets && markets.length === 0 && !marketsError && (
            <p className="text-zinc-500 text-sm">
              No markets loaded yet. Try a search above (e.g. &quot;Trump&quot;, &quot;BTC&quot;, &quot;NVIDIA&quot;).
            </p>
          )}

          {markets.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {markets.map((m) => (
                <a
                  key={`${m.platform}-${m.id}`}
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4 hover:border-emerald-500 transition-colors flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-xs text-zinc-300 font-mono uppercase">
                      {m.platform}
                    </span>
                    {m.category && (
                      <span className="text-xs text-zinc-500 truncate max-w-[10rem]">{m.category}</span>
                    )}
                  </div>
                  <h2 className="text-sm font-semibold text-zinc-100 line-clamp-3">{m.question}</h2>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between text-zinc-400">
                      <span>YES</span>
                      <span className="font-mono text-zinc-100">{formatPercent(m.yesPrice)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${(m.yesPrice ?? 0) * 100}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-zinc-400">
                      <span>NO</span>
                      <span className="font-mono text-zinc-100">{formatPercent(m.noPrice)}</span>
                    </div>
                  </div>
                  <div className="mt-auto flex justify-between text-xs text-zinc-500">
                    <span>Vol: {m.volume?.toLocaleString() ?? "–"}</span>
                    {m.endDate && <span>Closes: {new Date(m.endDate).toLocaleDateString()}</span>}
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === "arbitrage" && (
        <section aria-label="Arbitrage opportunities" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => loadArbitrage()}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50"
              disabled={loadingArb}
            >
              {loadingArb ? "Scanning…" : "Scan for arbitrage"}
            </button>
            <button
              type="button"
              onClick={() => loadArbitrage(0.03)}
              className="px-3 py-2 rounded-lg border border-zinc-600 hover:bg-zinc-800 text-zinc-300 text-sm"
            >
              Min 3% spread
            </button>
            <button
              type="button"
              onClick={() => loadArbitrage(0.05)}
              className="px-3 py-2 rounded-lg border border-zinc-600 hover:bg-zinc-800 text-zinc-300 text-sm"
            >
              Min 5% spread
            </button>
            <p className="text-zinc-500 text-xs">
              Looks for price discrepancies between Polymarket and Manifold. This is informational only – not trading
              advice.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyArbitrageSummary}
              disabled={opportunities.length === 0}
              className="px-3 py-1.5 text-sm border border-zinc-600 hover:bg-zinc-800 text-zinc-300 rounded-lg disabled:opacity-50"
            >
              {copyFeedback === "arb" ? "Copied!" : "Copy arbitrage summary"}
            </button>
            <button
              type="button"
              onClick={() => copyArbitrageThread()}
              disabled={opportunities.length === 0}
              className="px-3 py-1.5 text-sm border border-zinc-600 hover:bg-zinc-800 text-zinc-300 rounded-lg disabled:opacity-50"
            >
              {copyFeedback === "arb" ? "Thread copied!" : "Copy thread for top arb"}
            </button>
          </div>
          <div className="min-h-[1.5rem] text-sm text-red-400">{arbError && <span>{arbError}</span>}</div>
          {loadingArb && opportunities.length === 0 && (
            <p className="text-zinc-500 text-sm">Scanning markets for potential arbitrage…</p>
          )}
          {!loadingArb && opportunities.length === 0 && !arbError && (
            <p className="text-zinc-500 text-sm">
              No strong cross-platform opportunities detected right now. Try again later or adjust your filters.
            </p>
          )}
          {opportunities.length > 0 && (
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-900">
                    <tr className="border-b border-zinc-700 text-left text-zinc-400">
                      <th className="p-3 font-medium">Question</th>
                      <th className="p-3 font-medium">Markets</th>
                      <th className="p-3 font-medium">Best YES</th>
                      <th className="p-3 font-medium">Best NO</th>
                      <th className="p-3 font-medium">Implied profit</th>
                      <th className="p-3 font-medium w-24"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {opportunities.map((o, idx) => {
                      const labels = getArbLabels(o);
                      return (
                        <tr
                          key={`${idx}-${o.question}`}
                          className="border-b border-zinc-800 hover:bg-zinc-800/40 cursor-pointer"
                          onClick={() => setSelectedArb(o)}
                        >
                          <td className="p-3 align-top text-zinc-100 max-w-xs">
                            <div className="line-clamp-3">{o.question}</div>
                            {labels.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {labels.map((l) => (
                                  <span
                                    key={l}
                                    className="px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300 text-[0.65rem]"
                                  >
                                    {l}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="p-3 align-top text-xs text-zinc-300">
                            <div className="space-y-1">
                              {o.markets.map((m) => (
                                <div key={`${m.platform}-${m.id}`}>
                                  <span className="font-mono text-[0.7rem] px-1.5 py-0.5 rounded bg-zinc-800 mr-1">
                                    {m.platform}
                                  </span>
                                  YES {formatPercent(m.yesPrice)} · NO {formatPercent(m.noPrice)}
                                </div>
                              ))}
                            </div>
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
                            {o.impliedProfit != null ? `${(o.impliedProfit * 100).toFixed(2)}%` : "–"}
                          </td>
                          <td className="p-3 align-top">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                sendMessageWithContext("Explain this arbitrage opportunity in simple terms, including risks and key considerations.", { opportunity: o });
                                setSelectedArb(null);
                              }}
                              className="px-2 py-1 text-xs rounded bg-violet-600/80 hover:bg-violet-600 text-white"
                            >
                              Explain
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {selectedArb && (
            <ArbDetailDrawer
              opportunity={selectedArb}
              onClose={() => setSelectedArb(null)}
              onExplain={() => {
                sendMessageWithContext("Explain this arbitrage opportunity in simple terms, including risks and key considerations.", { opportunity: selectedArb });
                setSelectedArb(null);
              }}
              onCopyThread={() => copyArbitrageThread(selectedArb)}
              memeCaptions={memeCaptions}
              memeLoading={memeLoading}
              memeError={memeError}
              onGenerateMeme={() => generateMemeCaptionsForArb(selectedArb)}
              onCopyMeme={copyMemeCaption}
            />
          )}
        </section>
      )}

      {activeTab === "chat" && (
        <section aria-label="Prediction chat" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyChatAnswer}
              disabled={!chatMessages.some((m) => m.role === "assistant")}
              className="px-3 py-1.5 text-sm border border-zinc-600 hover:bg-zinc-800 text-zinc-300 rounded-lg disabled:opacity-50"
            >
              {copyFeedback === "chat" ? "Copied!" : "Copy last answer"}
            </button>
          </div>
          <p className="text-zinc-500 text-sm">
            Ask about specific markets, cross-platform spreads, or arbitrage risk. The agent can reference the markets
            and opportunities you&apos;ve loaded.
          </p>
          <div className="flex flex-wrap gap-2 mb-2">
            {["Only high-volume crypto markets", "Compare Polymarket vs Manifold", "Biggest arbitrage opportunities", "Risks of cross-platform arbitrage"].map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => setChatInput(label)}
                className="px-3 py-1 text-xs rounded-full border border-zinc-600 hover:bg-zinc-800 text-zinc-300"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/40 p-4 h-[420px] flex flex-col">
            <div className="flex-1 overflow-y-auto space-y-3 pr-1" role="log" aria-live="polite" aria-label="Chat messages">
              {chatMessages.length === 0 && (
                <p className="text-zinc-500 text-sm">
                  Example questions: &quot;Which current markets have the largest price difference between platforms?&quot;
                  or &quot;Explain the risks of this arbitrage&quot;.
                </p>
              )}
              {chatMessages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "bg-emerald-600 text-white rounded-br-sm"
                        : "bg-zinc-800 text-zinc-100 rounded-bl-sm"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="mt-3 flex gap-2"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask about markets or arbitrage (e.g. 'Compare these BTC markets')"
                className="flex-1 border border-zinc-700 rounded-lg bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <button
                type="submit"
                disabled={sending || !chatInput.trim()}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium disabled:opacity-50"
              >
                {sending ? "Thinking…" : "Send"}
              </button>
            </form>
          </div>
        </section>
      )}

      <section className="mt-6 pb-4 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="font-medium">Mode:</span>
          <button
            type="button"
            onClick={() => setDegenMode(false)}
            className={`px-2 py-1 rounded-full border ${
              !degenMode ? "bg-zinc-200 text-zinc-900" : "border-zinc-600 text-zinc-300"
            } text-xs`}
          >
            Classic
          </button>
          <button
            type="button"
            onClick={() => setDegenMode(true)}
            className={`px-2 py-1 rounded-full border ${
              degenMode ? "bg-amber-400 text-black" : "border-zinc-600 text-zinc-300"
            } text-xs flex items-center gap-1`}
          >
            <span>🔥</span>
            <span>Degen</span>
          </button>
        </div>
        {degenMode && (
          <span className="text-[0.7rem] text-amber-300">
            Meme mode on – copyable threads get extra spicy.
          </span>
        )}
      </section>

      <section className="mt-6 pt-4 border-t border-zinc-800" aria-label="AI dashboard">
        <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wide mb-1">AI dashboard</h2>
        <p className="text-zinc-500 text-sm mb-4">
          Generate a custom dashboard from your current markets and arbitrage data. Then ask for a different view in plain language.
        </p>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            Model:
            <select
              value={ugiProvider}
              onChange={onUgiProviderChange}
              className="border border-zinc-600 rounded bg-zinc-900 px-2 py-1 text-zinc-200"
              aria-label="AI provider for UGI generation"
            >
              <option value="openai">OpenAI (gpt-4o-mini)</option>
              <option value="anthropic">Anthropic (Claude Haiku)</option>
            </select>
          </label>
          <button
            type="button"
            onClick={generateUgiDashboard}
            disabled={ugiStreaming || (markets.length === 0 && opportunities.length === 0)}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            aria-busy={ugiStreaming}
          >
            {ugiStreaming ? "Generating…" : "Generate AI dashboard"}
          </button>
        </div>
        <div role="alert" aria-live="assertive" className="min-h-[1.5rem]">
          {ugiError && <p className="text-red-400 text-sm mb-4">{ugiError}</p>}
        </div>

        {markets.length === 0 && opportunities.length === 0 && (
          <p className="text-zinc-500 text-sm mb-4">
            Load markets or arbitrage data above first, then generate a custom AI dashboard.
          </p>
        )}

        {(markets.length > 0 || opportunities.length > 0) && (
          <div className="mb-4 p-4 rounded-xl border border-zinc-700 bg-zinc-900/30">
            <p className="text-zinc-300 text-sm font-medium mb-2">Ask for a different view</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {FOLLOW_UP_CHIPS.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setFollowUpPrompt(label)}
                  className="px-3 py-1.5 text-sm border border-zinc-600 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                requestViewUpdate(followUpPrompt);
              }}
              className="flex flex-wrap gap-2"
            >
              <input
                type="text"
                value={followUpPrompt}
                onChange={(e) => setFollowUpPrompt(e.target.value)}
                placeholder="e.g. Only show arbitrage with profit > 3%"
                className="flex-1 min-w-[240px] border border-zinc-600 rounded-lg bg-zinc-900 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                aria-label="Describe the view you want"
              />
              <button
                type="submit"
                disabled={ugiStreaming || !followUpPrompt.trim()}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-colors"
                aria-busy={ugiStreaming}
              >
                {ugiStreaming ? "Updating…" : "Update view"}
              </button>
            </form>
          </div>
        )}

        {ugiSpec?.root && (
          <StateProvider initialState={initialData}>
            <VisibilityProvider>
              <ValidationProvider customFunctions={validators}>
                <ActionProvider handlers={getActionHandlers()}>
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={copySpecJson}
                        className="px-3 py-1.5 text-sm border border-zinc-600 hover:bg-zinc-800 text-zinc-300 rounded-lg"
                      >
                        {copyFeedback === "spec" ? "Copied!" : "Copy spec (JSON)"}
                      </button>
                      <button
                        type="button"
                        onClick={copySummary}
                        className="px-3 py-1.5 text-sm border border-zinc-600 hover:bg-zinc-800 text-zinc-300 rounded-lg"
                      >
                        {copyFeedback === "summary" ? "Copied!" : "Copy summary"}
                      </button>
                      <button
                        type="button"
                        onClick={copyExportCode}
                        className="px-3 py-1.5 text-sm border border-zinc-600 hover:bg-zinc-800 text-zinc-300 rounded-lg"
                      >
                        {copyFeedback === "code" ? "Copied!" : "Export code"}
                      </button>
                      <button
                        type="button"
                        onClick={saveDashboard}
                        className="px-3 py-1.5 text-sm border border-zinc-600 hover:bg-zinc-800 text-zinc-300 rounded-lg"
                      >
                        {copyFeedback === "saved" ? "Saved!" : "Save dashboard"}
                      </button>
                      {canRestoreSaved && (
                        <button
                          type="button"
                          onClick={restoreSavedDashboard}
                          className="px-3 py-1.5 text-sm border border-emerald-600 hover:bg-emerald-900/30 text-emerald-300 rounded-lg"
                        >
                          {copyFeedback === "restored" ? "Restored!" : "Restore saved"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={copyDashboardLink}
                        className="px-3 py-1.5 text-sm border border-zinc-600 hover:bg-zinc-800 text-zinc-300 rounded-lg"
                      >
                        {copyFeedback === "link" ? "Link copied!" : "Copy dashboard link"}
                      </button>
                    </div>
                    <div className="rounded-xl border border-zinc-700 bg-zinc-900/30 p-4 min-h-[120px]" aria-busy={ugiStreaming}>
                      <Renderer
                        spec={toSpec(ugiSpec)}
                        registry={registry}
                        loading={ugiStreaming}
                      />
                    </div>
                  </div>
                </ActionProvider>
              </ValidationProvider>
            </VisibilityProvider>
          </StateProvider>
        )}
      </section>
    </main>
  );
}

function ArbDetailDrawer(props: {
  opportunity: ArbitrageOpportunity;
  onClose: () => void;
  onExplain: () => void;
  onCopyThread: () => void;
  memeCaptions: string[];
  memeLoading: boolean;
  memeError: string | null;
  onGenerateMeme: () => void;
  onCopyMeme: (index: number) => void;
}) {
  const { opportunity, onClose, onExplain, onCopyThread, memeCaptions, memeLoading, memeError, onGenerateMeme, onCopyMeme } = props;
  const o = opportunity;
  const labels = getArbLabels(o);
  const yesCost = o.bestYesBuy?.price ?? 0;
  const noCost = o.bestNoBuy?.price ?? 0;
  const totalCost = yesCost + noCost;
  const profit = totalCost < 1 ? 1 - totalCost : 0;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleEscape);
    closeBtnRef.current?.focus();
    return () => document.removeEventListener("keydown", handleEscape);
  }, [handleEscape]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="presentation">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        className="relative rounded-t-xl sm:rounded-xl border border-zinc-700 bg-zinc-900 w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="arb-drawer-title"
        aria-describedby="arb-drawer-desc"
      >
        <div className="p-4 border-b border-zinc-700 flex items-center justify-between sticky top-0 bg-zinc-900">
          <h3 id="arb-drawer-title" className="text-lg font-semibold text-zinc-100">Arbitrage details</h3>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div id="arb-drawer-desc" className="p-4 space-y-4">
          <p className="text-zinc-200">{o.question}</p>
          {labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {labels.map((l) => (
                <span key={l} className="px-2 py-0.5 rounded bg-amber-900/50 text-amber-300 text-xs">
                  {l}
                </span>
              ))}
            </div>
          )}
          <div className="rounded-lg bg-zinc-800/80 p-4 space-y-2">
            <h4 className="text-sm font-medium text-zinc-300">Math</h4>
            <p className="text-sm text-zinc-400 font-mono">
              Buy YES @ {formatPercent(o.bestYesBuy?.price)} + Buy NO @ {formatPercent(o.bestNoBuy?.price)} = {formatPercent(totalCost)} total cost
            </p>
            <p className="text-sm text-zinc-400">
              If both resolve correctly: payoff = 1. Implied profit = {formatPercent(profit)} before fees.
            </p>
          </div>
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-zinc-300">Markets</h4>
            {o.markets.map((m) => (
              <div key={`${m.platform}-${m.id}`} className="flex items-center justify-between text-sm">
                <span className="text-zinc-300">{m.platform}</span>
                <span className="text-zinc-400">
                  YES {formatPercent(m.yesPrice)} · NO {formatPercent(m.noPrice)} · Vol: {m.volume?.toLocaleString() ?? "–"}
                </span>
                {m.url && (
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Open
                  </a>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={onExplain}
              className="flex-1 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium text-sm"
            >
              Explain this opportunity
            </button>
            <button
              type="button"
              onClick={onCopyThread}
              className="flex-1 px-4 py-2 rounded-lg border border-zinc-600 hover:bg-zinc-800 text-zinc-200 font-medium text-sm"
            >
              Copy social thread
            </button>
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-zinc-300">Meme captions</h4>
              <button
                type="button"
                onClick={onGenerateMeme}
                disabled={memeLoading}
                className="px-3 py-1.5 text-xs border border-zinc-600 rounded-lg text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                {memeLoading ? "Brewing…" : "Get memes"}
              </button>
            </div>
            {memeError && <p className="text-xs text-red-400">{memeError}</p>}
            {memeCaptions.length > 0 && (
              <ul className="space-y-1">
                {memeCaptions.map((c, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-zinc-200">
                    <span className="mt-0.5 text-zinc-500">{idx + 1}.</span>
                    <span className="flex-1">{c}</span>
                    <button
                      type="button"
                      onClick={() => onCopyMeme(idx)}
                      className="ml-2 px-2 py-0.5 text-[0.7rem] border border-zinc-600 rounded hover:bg-zinc-800"
                    >
                      {/** reuse meme feedback styling via clipboard toast */}
                      Copy
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
