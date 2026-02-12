"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useSearchParams } from "next/navigation";
import { createSpecStreamCompiler } from "@json-render/core";
import { specToReactLikeCode } from "@/lib/code-export";
import type { PredictionMarket, ArbitrageOpportunity } from "@/lib/predictions/types";

export type ChatMessage = { role: "user" | "assistant"; content: string };

type UgiSpecShape = { root: string; elements: Record<string, unknown> };
type UgiSpecFlat = { root: string; elements: Record<string, { type: string; props: Record<string, unknown>; children: string[] }> };
type UgiElementLike = { type?: string; props?: Record<string, unknown>; children?: string[] };

const DASHBOARD_STORAGE_KEY = "predictions:ugi";
const VIEWS_STORAGE_KEY = "predictions:views";

type SavedView = {
  id: string;
  name: string;
  tab: "markets" | "arbitrage" | "chat";
  platform: "all" | "polymarket" | "manifold";
  query: string;
  createdAt: string;
};

function specToHash(spec: UgiSpecShape | null): string {
  if (!spec?.root && !(spec?.elements && Object.keys(spec.elements).length > 0)) return "";
  try {
    const json = JSON.stringify(spec);
    const base64 = typeof btoa !== "undefined" ? btoa(unescape(encodeURIComponent(json))) : "";
    return base64.replace(/\//g, "_").replace(/\+/g, "-").replace(/=+$/, "");
  } catch {
    return "";
  }
}

function hashToSpec(hash: string): UgiSpecShape | null {
  if (!hash) return null;
  try {
    let base64 = hash.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    if (pad) base64 += "=".repeat(4 - pad);
    const json = decodeURIComponent(escape(typeof atob !== "undefined" ? atob(base64) : ""));
    const parsed = JSON.parse(json) as { root?: string; elements?: Record<string, unknown> };
    return parsed && (parsed.root || (parsed.elements && Object.keys(parsed.elements).length > 0))
      ? { root: parsed.root ?? "", elements: parsed.elements ?? {} }
      : null;
  } catch {
    return null;
  }
}

export type PredictionsState = {
  activeTab: "markets" | "arbitrage" | "chat";
  setActiveTab: (tab: "markets" | "arbitrage" | "chat") => void;
  platform: "all" | "polymarket" | "manifold";
  setPlatform: (p: "all" | "polymarket" | "manifold") => void;
  degenMode: boolean;
  setDegenMode: (value: boolean) => void;
  query: string;
  setQuery: (q: string) => void;
  loadingMarkets: boolean;
  marketsError: string | null;
  markets: PredictionMarket[];
  loadMarkets: (q?: string, opts?: { platform?: "all" | "polymarket" | "manifold" }) => void;
  loadingArb: boolean;
  arbError: string | null;
  opportunities: ArbitrageOpportunity[];
  loadArbitrage: (minSpread?: number) => void;
  chatMessages: ChatMessage[];
  chatInput: string;
  setChatInput: (v: string) => void;
  sending: boolean;
  sendMessage: () => void;
  sendMessageWithContext: (content: string, extraContext?: { opportunity?: ArbitrageOpportunity }) => void;
  ugiSpec: UgiSpecShape | null;
  ugiStreaming: boolean;
  ugiError: string | null;
  ugiProvider: "openai" | "anthropic";
  onUgiProviderChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  copyFeedback: "spec" | "summary" | "markets" | "arb" | "chat" | "code" | "link" | "saved" | "restored" | "meme" | null;
  followUpPrompt: string;
  setFollowUpPrompt: (value: string) => void;
  generateUgiDashboard: () => void;
  copySpecJson: () => void;
  copySummary: () => void;
  copyMarketsSummary: () => void;
  copyArbitrageSummary: () => void;
  copyChatAnswer: () => void;
  copyExportCode: () => void;
  requestViewUpdate: (promptText: string) => void;
  getActionHandlers: () => { submit: () => void; navigate: (params: unknown) => void; copy: (params: unknown) => Promise<void> };
  saveDashboard: () => void;
  restoreSavedDashboard: () => void;
  copyDashboardLink: () => void;
  canRestoreSaved: boolean;
  savedViews: SavedView[];
  saveCurrentView: (name: string) => void;
  applySavedView: (id: string) => void;
  deleteSavedView: (id: string) => void;
  copyArbitrageThread: (opp?: ArbitrageOpportunity) => void;
  memeCaptions: string[];
  memeLoading: boolean;
  memeError: string | null;
  generateMemeCaptionsForArb: (opp: ArbitrageOpportunity) => void;
  clearMemeCaptions: () => void;
  copyMemeCaption: (index: number) => void;
};

export function usePredictions(): PredictionsState {
  const [activeTab, setActiveTab] = useState<"markets" | "arbitrage" | "chat">("markets");
  const [platform, setPlatform] = useState<"all" | "polymarket" | "manifold">("all");
  const [query, setQuery] = useState("");
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [markets, setMarkets] = useState<PredictionMarket[]>([]);

  const [loadingArb, setLoadingArb] = useState(false);
  const [arbError, setArbError] = useState<string | null>(null);
  const [opportunities, setOpportunities] = useState<ArbitrageOpportunity[]>([]);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const [ugiSpec, setUgiSpec] = useState<UgiSpecShape | null>(null);
  const [ugiStreaming, setUgiStreaming] = useState(false);
  const [ugiError, setUgiError] = useState<string | null>(null);
  const [ugiProvider, setUgiProvider] = useState<"openai" | "anthropic">("openai");
  const [copyFeedback, setCopyFeedback] = useState<"spec" | "summary" | "markets" | "arb" | "chat" | "code" | "link" | "saved" | "restored" | "meme" | null>(null);
  const [followUpPrompt, setFollowUpPrompt] = useState("");
  const [degenMode, setDegenModeState] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [memeCaptions, setMemeCaptions] = useState<string[]>([]);
  const [memeLoading, setMemeLoading] = useState(false);
  const [memeError, setMemeError] = useState<string | null>(null);
  const compilerRef = useRef<ReturnType<typeof createSpecStreamCompiler> | null>(null);
  const ugiAbortRef = useRef<AbortController | null>(null);
  const urlRestoredRef = useRef(false);
  const initialLoadDoneRef = useRef(false);

  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.slice(1);
    const match = /^spec=(.+)$/.exec(hash);
    const encoded = match?.[1];
    if (encoded) {
      const spec = hashToSpec(encoded);
      if (spec) setUgiSpec(spec);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem("predictions:degenMode");
      if (raw === "1") setDegenModeState(true);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("predictions:degenMode", degenMode ? "1" : "0");
    } catch {
      // ignore
    }
  }, [degenMode]);

  useEffect(() => {
    if (typeof window === "undefined" || !ugiSpec?.root) return;
    const encoded = specToHash(ugiSpec);
    if (!encoded) return;
    const newHash = `#spec=${encoded}`;
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
    }
  }, [ugiSpec]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(VIEWS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedView[] | unknown;
      if (Array.isArray(parsed)) {
        setSavedViews(
          parsed.filter(
            (v): v is SavedView =>
              typeof v === "object" &&
              v !== null &&
              typeof (v as SavedView).id === "string" &&
              typeof (v as SavedView).name === "string"
          )
        );
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", activeTab);
    url.searchParams.set("platform", platform);
    url.searchParams.set("query", query);
    if (url.search !== window.location.search) {
      window.history.replaceState({}, "", url.pathname + url.search + (window.location.hash || ""));
    }
  }, [activeTab, platform, query]);

  const loadMarkets = useCallback(
    async (q?: string, opts?: { platform?: "all" | "polymarket" | "manifold" }) => {
      const term = q ?? query;
      const plat = opts?.platform ?? platform;
      setLoadingMarkets(true);
      setMarketsError(null);
      try {
        const res = await fetch("/api/predictions/markets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: term, platform: plat }),
        });
        const json = await res.json();
        if (!res.ok) {
          setMarketsError(json.error ?? "Failed to load markets");
          return;
        }
        setMarkets(json.markets ?? []);
      } catch (err) {
        setMarketsError(err instanceof Error ? err.message : "Network error");
      } finally {
        setLoadingMarkets(false);
      }
    },
    [platform, query]
  );

  useEffect(() => {
    const t = searchParams.get("tab") as "markets" | "arbitrage" | "chat" | null;
    const p = searchParams.get("platform") as "all" | "polymarket" | "manifold" | null;
    const q = searchParams.get("query") ?? "";
    if (t && ["markets", "arbitrage", "chat"].includes(t)) setActiveTab(t);
    if (p && ["all", "polymarket", "manifold"].includes(p)) setPlatform(p);
    setQuery(q);
    if (!urlRestoredRef.current && q && (t === "markets" || !t)) {
      urlRestoredRef.current = true;
      loadMarkets(q, p ? { platform: p } : undefined);
    }
  }, [searchParams, loadMarkets]);

  const loadArbitrage = useCallback(async (minSpread = 0.01) => {
    setLoadingArb(true);
    setArbError(null);
    try {
      const res = await fetch("/api/predictions/arbitrage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minSpread, limit: 50 }),
      });
      const json = await res.json();
      if (!res.ok) {
        setArbError(json.error ?? "Failed to load arbitrage");
        return;
      }
      setOpportunities(json.opportunities ?? []);
    } catch (err) {
      setArbError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoadingArb(false);
    }
  }, []);

  const applyIntent = useCallback(
    (intent: unknown) => {
      if (!intent || typeof intent !== "object") return;
      const base = intent as { action?: string; criteria?: unknown };
      if (!base.action) return;

      if (base.action === "filterMarkets" && base.criteria && typeof base.criteria === "object") {
        const c = base.criteria as { query?: unknown; platform?: unknown };
        const nextQuery = typeof c.query === "string" ? c.query : query;
        const platRaw = typeof c.platform === "string" ? c.platform : null;
        const nextPlatform: "all" | "polymarket" | "manifold" =
          platRaw === "polymarket" || platRaw === "manifold" || platRaw === "all"
            ? (platRaw as "all" | "polymarket" | "manifold")
            : platform;
        setPlatform(nextPlatform);
        setQuery(nextQuery);
        loadMarkets(nextQuery, { platform: nextPlatform });
        setActiveTab("markets");
      } else if (base.action === "filterArbitrage" && base.criteria && typeof base.criteria === "object") {
        const c = base.criteria as { minSpread?: unknown };
        const min =
          typeof c.minSpread === "number" && Number.isFinite(c.minSpread) && c.minSpread > 0
            ? c.minSpread
            : 0.01;
        loadArbitrage(min);
        setActiveTab("arbitrage");
      }
    },
    [platform, query, loadMarkets, loadArbitrage]
  );

  const saveCurrentView = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || typeof window === "undefined") return;
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const view: SavedView = {
        id,
        name: trimmed,
        tab: activeTab,
        platform,
        query,
        createdAt: new Date().toISOString(),
      };
      setSavedViews((prev) => {
        const next = [view, ...prev].slice(0, 20);
        try {
          localStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore persist errors
        }
        return next;
      });
    },
    [activeTab, platform, query]
  );

  const applySavedView = useCallback(
    (id: string) => {
      const view = savedViews.find((v) => v.id === id);
      if (!view) return;
      setActiveTab(view.tab);
      setPlatform(view.platform);
      setQuery(view.query);
      if (view.tab === "markets") {
        loadMarkets(view.query, { platform: view.platform });
      } else if (view.tab === "arbitrage") {
        loadArbitrage();
      }
    },
    [savedViews, loadMarkets, loadArbitrage]
  );

  const deleteSavedView = useCallback((id: string) => {
    setSavedViews((prev) => {
      const next = prev.filter((v) => v.id !== id);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
      }
      return next;
    });
  }, []);

  const sendMessage = useCallback(async () => {
    const content = chatInput.trim();
    if (!content) return;
    const nextMessages: ChatMessage[] = [...chatMessages, { role: "user", content }];
    setChatMessages(nextMessages);
    setChatInput("");
    setSending(true);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/predictions/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          context: { markets, opportunities },
        }),
        signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) {
        setChatMessages((msgs) => [...msgs, { role: "assistant", content: "Sorry, I couldn't respond right now." }]);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      setChatMessages((msgs) => [...msgs, { role: "assistant", content: "" }]);
      const assistantIndex = nextMessages.length;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const updated = acc;
        setChatMessages((msgs) => {
          const copy = [...msgs];
          const msg = copy[assistantIndex];
          if (msg && msg.role === "assistant") {
            copy[assistantIndex] = { ...msg, content: updated };
          }
          return copy;
        });
      }

      if (acc) {
        let finalText = acc;
        let parsedIntent: unknown = null;
        const intentMatch = acc.match(/INTENT:\s*(\{[\s\S]*\})\s*$/);
        if (intentMatch && typeof intentMatch.index === "number") {
          const intentJson = intentMatch[1];
          try {
            parsedIntent = JSON.parse(intentJson);
          } catch {
            parsedIntent = null;
          }
          finalText = acc.slice(0, intentMatch.index).trimEnd();
        }
        setChatMessages((msgs) => {
          const copy = [...msgs];
          const msg = copy[assistantIndex];
          if (msg && msg.role === "assistant") {
            copy[assistantIndex] = { ...msg, content: finalText };
          }
          return copy;
        });
        if (parsedIntent) applyIntent(parsedIntent);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setChatMessages((msgs) => [...msgs, { role: "assistant", content: "Error while streaming response." }]);
      }
    } finally {
      setSending(false);
    }
  }, [chatInput, chatMessages, markets, opportunities, applyIntent]);

  const sendMessageWithContext = useCallback(
    (content: string, extraContext?: { opportunity?: ArbitrageOpportunity }) => {
      const nextMessages: ChatMessage[] = [...chatMessages, { role: "user", content }];
      setChatInput("");
      setChatMessages(nextMessages);
      setActiveTab("chat");
      const ctx = extraContext?.opportunity
        ? { markets, opportunities: [extraContext.opportunity] }
        : { markets, opportunities };
      setSending(true);
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      (async () => {
        try {
          const res = await fetch("/api/predictions/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: nextMessages,
              context: ctx,
            }),
            signal: abortRef.current!.signal,
          });
          if (!res.ok || !res.body) {
            setChatMessages((msgs) => [...msgs, { role: "assistant", content: "Sorry, I couldn't respond right now." }]);
            return;
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let acc = "";
          setChatMessages((msgs) => [...msgs, { role: "assistant", content: "" }]);
          const assistantIndex = nextMessages.length;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            acc += decoder.decode(value, { stream: true });
            const updated = acc;
            setChatMessages((msgs) => {
              const copy = [...msgs];
              const msg = copy[assistantIndex];
              if (msg && msg.role === "assistant") {
                copy[assistantIndex] = { ...msg, content: updated };
              }
              return copy;
            });
          }

          if (acc) {
            let finalText = acc;
            let parsedIntent: unknown = null;
            const intentMatch = acc.match(/INTENT:\s*(\{[\s\S]*\})\s*$/);
            if (intentMatch && typeof intentMatch.index === "number") {
              const intentJson = intentMatch[1];
              try {
                parsedIntent = JSON.parse(intentJson);
              } catch {
                parsedIntent = null;
              }
              finalText = acc.slice(0, intentMatch.index).trimEnd();
            }
            setChatMessages((msgs) => {
              const copy = [...msgs];
              const msg = copy[assistantIndex];
              if (msg && msg.role === "assistant") {
                copy[assistantIndex] = { ...msg, content: finalText };
              }
              return copy;
            });
            if (parsedIntent) applyIntent(parsedIntent);
          }
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            setChatMessages((msgs) => [...msgs, { role: "assistant", content: "Error while streaming response." }]);
          }
        } finally {
          setSending(false);
        }
      })();
    },
    [chatMessages, markets, opportunities, applyIntent]
  );

  const generateUgiDashboard = useCallback(async () => {
    ugiAbortRef.current?.abort();
    ugiAbortRef.current = new AbortController();
    compilerRef.current = createSpecStreamCompiler({ root: "", elements: {} });
    setUgiSpec({ root: "", elements: {} });
    setUgiStreaming(true);
    setUgiError(null);
    try {
      const res = await fetch("/api/predictions/generate-dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: ugiProvider,
          markets,
          opportunities,
        }),
        signal: ugiAbortRef.current.signal,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.details ?? j.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const out = compilerRef.current!.push(chunk);
        if (out.newPatches.length > 0 && out.result) {
          const spec = out.result as UgiSpecShape;
          setUgiSpec({ root: spec.root ?? "", elements: spec.elements ?? {} });
        }
      }
      const final = compilerRef.current!.getResult() as UgiSpecShape | undefined;
      if (final && (final.root || Object.keys(final.elements ?? {}).length > 0)) {
        setUgiSpec({ root: final.root ?? "", elements: final.elements ?? {} });
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setUgiError(err instanceof Error ? err.message : String(err));
    } finally {
      setUgiStreaming(false);
    }
  }, [markets, opportunities, ugiProvider]);

  const requestViewUpdate = useCallback(
    async (promptText: string) => {
      const promptTrimmed = promptText.trim();
      if (!promptTrimmed) return;
      ugiAbortRef.current?.abort();
      ugiAbortRef.current = new AbortController();
      compilerRef.current = createSpecStreamCompiler({ root: "", elements: {} });
      setUgiSpec((prev) => (prev ? { root: "", elements: {} } : null));
      setUgiStreaming(true);
      setUgiError(null);
      const payload = {
        provider: ugiProvider,
        followUpPrompt: promptTrimmed,
        markets,
        opportunities,
        ...(ugiSpec?.root ? { currentSpec: ugiSpec } : {}),
      };
      try {
        const res = await fetch("/api/predictions/generate-dashboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: ugiAbortRef.current.signal,
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.details ?? j.error ?? `HTTP ${res.status}`);
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const out = compilerRef.current!.push(chunk);
          if (out.newPatches.length > 0 && out.result) {
            const spec = out.result as UgiSpecShape;
            setUgiSpec({ root: spec.root ?? "", elements: spec.elements ?? {} });
          }
        }
        const final = compilerRef.current!.getResult() as UgiSpecShape | undefined;
        if (final && (final.root || Object.keys(final.elements ?? {}).length > 0)) {
          setUgiSpec({ root: final.root ?? "", elements: final.elements ?? {} });
        }
        setFollowUpPrompt("");
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setUgiError(err instanceof Error ? err.message : String(err));
      } finally {
        setUgiStreaming(false);
      }
    },
    [ugiProvider, markets, opportunities, ugiSpec]
  );

  const onUgiProviderChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setUgiProvider(e.target.value as "openai" | "anthropic");
  }, []);

  const getActionHandlers = useCallback(
    () => ({
      submit: () => {},
      navigate: (params: unknown) => {
        const p = params as { url?: string };
        if (p?.url) window.open(p.url, "_blank", "noopener,noreferrer");
      },
      copy: async (params: unknown) => {
        const text = (params as { text?: string })?.text;
        if (!text || typeof text !== "string") return;
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // best effort copy
        }
      },
    }),
    []
  );

  const copySpecJson = useCallback(() => {
    if (!ugiSpec?.root) return;
    navigator.clipboard.writeText(JSON.stringify(ugiSpec, null, 2)).then(() => {
      setCopyFeedback("spec");
      setTimeout(() => setCopyFeedback(null), 2000);
    });
  }, [ugiSpec]);

  const copySummary = useCallback(() => {
    const lines: string[] = ["Prediction Markets Summary"];
    if (markets.length > 0) {
      lines.push(`\nMarkets (${markets.length}):`);
      markets.slice(0, 10).forEach((m) => {
        lines.push(`- ${m.question} (${m.platform}): YES ${(m.yesPrice * 100).toFixed(1)}% | ${m.url ?? ""}`);
      });
    }
    if (opportunities.length > 0) {
      lines.push(`\nArbitrage (${opportunities.length}):`);
      opportunities.slice(0, 5).forEach((o) => {
        lines.push(`- ${o.question}: ${o.impliedProfit != null ? (o.impliedProfit * 100).toFixed(2) : "—"}% profit`);
      });
    }
    if (ugiSpec?.root) lines.push("\n(UGI dashboard generated)");
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopyFeedback("summary");
      setTimeout(() => setCopyFeedback(null), 2000);
    });
  }, [markets, opportunities, ugiSpec]);

  const copyMarketsSummary = useCallback(() => {
    const lines: string[] = [`Prediction Markets (${markets.length})`, `Query: ${query || "trending"} | Platform: ${platform}`, ""];
    markets.slice(0, 15).forEach((m) => {
      lines.push(`${m.question}\n  ${m.platform} | YES ${(m.yesPrice * 100).toFixed(1)}% | NO ${(m.noPrice * 100).toFixed(1)}% | Vol: ${m.volume?.toLocaleString() ?? "—"}\n  ${m.url ?? ""}\n`);
    });
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopyFeedback("markets");
      setTimeout(() => setCopyFeedback(null), 2000);
    });
  }, [markets, query, platform]);

  const copyArbitrageSummary = useCallback(() => {
    const lines: string[] = [`Arbitrage Opportunities (${opportunities.length})`, ""];
    opportunities.slice(0, 15).forEach((o) => {
      const profit = o.impliedProfit != null ? (o.impliedProfit * 100).toFixed(2) : "—";
      lines.push(`${o.question} | Implied profit: ${profit}%`);
      o.markets.forEach((m) => {
        lines.push(`  ${m.platform}: YES ${(m.yesPrice * 100).toFixed(1)}% | ${m.url ?? ""}`);
      });
      lines.push("");
    });
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopyFeedback("arb");
      setTimeout(() => setCopyFeedback(null), 2000);
    });
  }, [opportunities]);

  const copyArbitrageThread = useCallback(
    (opp?: ArbitrageOpportunity) => {
      const target = opp ?? opportunities[0];
      if (!target) return;
      const bestYes = target.bestYesBuy;
      const bestNo = target.bestNoBuy;
      const profitPct = target.impliedProfit != null ? (target.impliedProfit * 100).toFixed(2) : "—";
      const lines: string[] = [];
      if (degenMode) {
        lines.push("1/3 🔥 Degen arb spotted:", target.question);
        if (bestYes && bestNo) {
          lines.push(
            "",
            `Long YES on ${bestYes.market.platform} @ ${(bestYes.price * 100).toFixed(2)}%`,
            `Short NO on ${bestNo.market.platform} @ ${(bestNo.price * 100).toFixed(2)}%`,
            `Paper edge: +${profitPct}% 💸 (pre-fees/slippage)`
          );
        } else {
          lines.push("", "Orderbooks disagree. Someone's getting farmed.");
        }
        lines.push(
          "",
          "2/3 Not advice. Mind liquidity, slippage, and off-ramp risk. Degens who overleverage get rekt.",
          "3/3 Full breakdown + live odds 👉"
        );
      } else {
        lines.push("1/3 Cross-platform prediction market arbitrage spotted:", target.question);
        if (bestYes && bestNo) {
          lines.push(
            "",
            `Buy YES on ${bestYes.market.platform} at ${(bestYes.price * 100).toFixed(2)}%.`,
            `Buy NO on ${bestNo.market.platform} at ${(bestNo.price * 100).toFixed(2)}%.`,
            `Theoretical edge before fees and slippage: ${profitPct}%`
          );
        } else {
          lines.push("", "Platforms quote meaningfully different prices, suggesting a potential edge.");
        }
        lines.push(
          "",
          "2/3 This is informational only, not investment advice.",
          "Real-world execution risk includes liquidity, slippage, fills, platform risk, and regulation.",
          "3/3 Explore the live table & details 👉"
        );
      }
      const link =
        typeof window !== "undefined"
          ? window.location.href
          : "/predictions?tab=arbitrage";
      lines.push("", link);
      navigator.clipboard.writeText(lines.join("\n")).then(() => {
        setCopyFeedback("arb");
        setTimeout(() => setCopyFeedback(null), 2000);
      });
    },
    [opportunities, degenMode]
  );

  const copyChatAnswer = useCallback(() => {
    const last = [...chatMessages].reverse().find((m) => m.role === "assistant");
    if (!last?.content) return;
    const prefix = "Prediction Markets Chat\n\n";
    const suffix = markets.length > 0 || opportunities.length > 0
      ? `\n\nContext: ${markets.length} markets, ${opportunities.length} arbitrage opportunities`
      : "";
    navigator.clipboard.writeText(prefix + last.content + suffix).then(() => {
      setCopyFeedback("chat");
      setTimeout(() => setCopyFeedback(null), 2000);
    });
  }, [chatMessages, markets.length, opportunities.length]);

  const copyExportCode = useCallback(() => {
    if (!ugiSpec?.root) return;
    const flat: UgiSpecFlat = {
      root: ugiSpec.root,
      elements: {},
    };
    for (const [k, v] of Object.entries(ugiSpec.elements ?? {})) {
      const el = v as UgiElementLike;
      flat.elements[k] = { type: el.type ?? "Card", props: el.props ?? {}, children: el.children ?? [] };
    }
    const code = specToReactLikeCode(flat);
    navigator.clipboard.writeText(code).then(() => {
      setCopyFeedback("code");
      setTimeout(() => setCopyFeedback(null), 2000);
    });
  }, [ugiSpec]);

  const saveDashboard = useCallback(() => {
    if (typeof window === "undefined" || !ugiSpec?.root) return;
    try {
      localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(ugiSpec));
      setCopyFeedback("saved");
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setCopyFeedback(null);
    }
  }, [ugiSpec]);

  const restoreSavedDashboard = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(DASHBOARD_STORAGE_KEY);
      if (raw) {
        const spec = JSON.parse(raw) as UgiSpecShape;
        if (spec?.root || (spec?.elements && Object.keys(spec.elements).length > 0)) {
          setUgiSpec({ root: spec.root ?? "", elements: spec.elements ?? {} });
          setCopyFeedback("restored");
          setTimeout(() => setCopyFeedback(null), 1500);
        }
      }
    } catch {
      setCopyFeedback(null);
    }
  }, []);

  const copyDashboardLink = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopyFeedback("link");
      setTimeout(() => setCopyFeedback(null), 2000);
    });
  }, []);

  const canRestoreSaved =
    typeof window !== "undefined" &&
    (() => {
      try {
        return localStorage.getItem(DASHBOARD_STORAGE_KEY) != null;
      } catch {
        return false;
      }
    })();

  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    const q = searchParams.get("query") ?? "";
    if (q) return;
    initialLoadDoneRef.current = true;
    loadMarkets();
  }, [searchParams, loadMarkets]);

  const generateMemeCaptionsForArb = useCallback(
    async (opp: ArbitrageOpportunity) => {
      setMemeLoading(true);
      setMemeError(null);
      setMemeCaptions([]);
      try {
        const res = await fetch("/api/predictions/meme-caption", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ opportunity: opp, tone: degenMode ? "degen" : "default" }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error ?? "Failed to generate meme captions");
        }
        const caps = Array.isArray(json.captions) ? json.captions.filter((c: unknown) => typeof c === "string") : [];
        setMemeCaptions(caps.slice(0, 5));
      } catch (err) {
        setMemeError(err instanceof Error ? err.message : String(err));
      } finally {
        setMemeLoading(false);
      }
    },
    [degenMode]
  );

  const clearMemeCaptions = useCallback(() => {
    setMemeCaptions([]);
    setMemeError(null);
  }, []);

  const copyMemeCaption = useCallback(
    (index: number) => {
      const text = memeCaptions[index];
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        setCopyFeedback("meme");
        setTimeout(() => setCopyFeedback(null), 2000);
      });
    },
    [memeCaptions]
  );

  return {
    activeTab,
    setActiveTab,
    platform,
    setPlatform,
    degenMode,
    setDegenMode: setDegenModeState,
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
  };
}
