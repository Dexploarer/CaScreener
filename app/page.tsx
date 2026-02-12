"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Renderer,
  StateProvider,
  ActionProvider,
  VisibilityProvider,
  ValidationProvider,
  useUIStream,
} from "@json-render/react";
import type { Spec } from "@json-render/core";
import { registry } from "@/lib/registry";
import {
  GenerationModeGrid,
  type GenerationMode,
} from "@/app/components/generation-mode-grid";
import {
  ViralCardNav,
  type ViralCardNavItem,
} from "@/app/components/viral-card-nav";

const initialData = {
  user: { name: "Anon" },
  form: { prompt: "" },
};

const validators: Record<
  string,
  (value: unknown, args?: Record<string, unknown>) => boolean | Promise<boolean>
> = {
  required: (v) => v != null && String(v).trim() !== "",
};

const landingLaneItems: ViralCardNavItem[] = [
  {
    label: "Launch Radar",
    summary:
      "Stream new pump.fun and LetsBonk launches, then surface early attention and migration risk in one pass.",
    background:
      "linear-gradient(160deg, rgba(5,150,105,0.38) 0%, rgba(9,9,11,0.88) 70%)",
    links: [
      {
        label: "Fresh launches",
        prompt: "Show me brand new pump.fun launches from the last few minutes.",
      },
      {
        label: "Migrations",
        prompt: "Track recent pump.fun migrations and show notable graduates.",
      },
      {
        label: "Hot volume",
        prompt:
          "Which new meme tokens just printed the largest SOL volume in the last 15 minutes?",
      },
    ],
  },
  {
    label: "Trust Engine",
    summary:
      "Scan copycats by ticker and mint, rank trust score 0-100, and explain every reason with hard links.",
    background:
      "linear-gradient(160deg, rgba(8,145,178,0.4) 0%, rgba(9,9,11,0.9) 70%)",
    links: [
      {
        label: "Clone scan",
        prompt:
          "Search for $LUNCH tokens and find clone contracts, fake tickers, and suspicious duplicates.",
      },
      {
        label: "Score reasons",
        prompt:
          "Give me trust score reasons for DfC2mRB5SNF1eCQZPh2cGi5QhNQnm3jRNHwa5Rtkpump with links.",
      },
      {
        label: "Image sweep",
        prompt:
          "Return all token images for ticker MOON and highlight which mints reuse the same branding.",
      },
    ],
  },
  {
    label: "Viral Studio",
    summary:
      "Package every result for distribution with thread copy, image cards, and short hype video prompts.",
    background:
      "linear-gradient(160deg, rgba(217,119,6,0.38) 0%, rgba(9,9,11,0.9) 70%)",
    links: [
      {
        label: "Share pack",
        prompt:
          "Create a share pack for this token with X thread draft, Farcaster post, and image card copy.",
      },
      {
        label: "Hype video",
        prompt:
          "Generate a short hype video timeline spec for the strongest meme narrative today.",
      },
      {
        label: "Alert funnel",
        prompt:
          "Set up alert messaging copy for Telegram and Discord when new ticker clones appear.",
      },
    ],
  },
];

const generationModes: GenerationMode[] = [
  {
    id: "launch-scanner",
    title: "Pump Launch Scanner",
    subtitle: "Realtime",
    description:
      "Auto-build dashboards from live launch, trade, and migration signals across pump ecosystems.",
    prompt:
      "Show a live pump.fun launch scanner dashboard with new tokens, migrations, and SOL flow.",
    stats: ["new launches", "trade velocity", "migration feed"],
    accent: "#10b981",
    gradient:
      "radial-gradient(circle at 15% 20%, rgba(16,185,129,0.45), transparent 52%)",
  },
  {
    id: "clone-hunter",
    title: "Ticker Clone Hunter",
    subtitle: "Anti-fake",
    description:
      "Find every token sharing a ticker so traders can detect impersonators before buying.",
    prompt:
      "Search for ticker clones for $LUNCH and return every matching token with images and mint links.",
    stats: ["ticker matches", "mint overlap", "branding reuse"],
    accent: "#06b6d4",
    gradient:
      "radial-gradient(circle at 90% 20%, rgba(6,182,212,0.45), transparent 50%)",
  },
  {
    id: "trust-forensics",
    title: "Trust Score Forensics",
    subtitle: "Scored",
    description:
      "Render a deterministic 0-100 trust score with explicit risk reasons and evidence links.",
    prompt:
      "Give me a trust score breakdown with explicit reasons and hard links for this meme token.",
    stats: ["risk evidence", "liquidity checks", "contract sanity"],
    accent: "#f59e0b",
    gradient:
      "radial-gradient(circle at 85% 25%, rgba(245,158,11,0.42), transparent 48%)",
  },
  {
    id: "meta-radar",
    title: "Meta Radar",
    subtitle: "Convex RAG",
    description:
      "Track narrative acceleration by ticker cluster and see which meme meta is emerging now.",
    prompt:
      "What meme token narrative is accelerating now? Group by ticker clusters and recent momentum.",
    stats: ["cluster momentum", "narrative drift", "meta velocity"],
    accent: "#a78bfa",
    gradient:
      "radial-gradient(circle at 20% 80%, rgba(167,139,250,0.42), transparent 52%)",
  },
  {
    id: "share-pack",
    title: "Share Pack Generator",
    subtitle: "Distribution",
    description:
      "Turn every result into post-ready social assets with thread copy and image card angles.",
    prompt:
      "Create a complete share pack: X thread, Farcaster post, and image card hooks for this token.",
    stats: ["x thread", "farcaster copy", "image card hooks"],
    accent: "#22d3ee",
    gradient:
      "radial-gradient(circle at 50% 5%, rgba(34,211,238,0.4), transparent 48%)",
  },
  {
    id: "alert-engine",
    title: "Watchlist Alert Engine",
    subtitle: "Retention",
    description:
      "Wire alerts for clone emergence and meta spikes to keep users returning in-session and off-session.",
    prompt:
      "Build a watchlist and alert plan for ticker clone events and narrative breakouts.",
    stats: ["telegram alerts", "discord alerts", "return sessions"],
    accent: "#fb7185",
    gradient:
      "radial-gradient(circle at 80% 90%, rgba(251,113,133,0.42), transparent 50%)",
  },
];

type AppPhase = "landing" | "loading" | "active";

interface HistoryEntry {
  prompt: string;
  spec: Spec;
}

function ChatApp() {
  const [phase, setPhase] = useState<AppPhase>("landing");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const { spec, isStreaming, error, send, clear } = useUIStream({
    api: "/api/generate",
  });

  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && spec) {
      setHistory((prev) => [
        ...prev,
        { prompt: currentPrompt, spec: spec as Spec },
      ]);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, spec, currentPrompt]);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [spec, history]);

  useEffect(() => {
    if (phase === "active" && !isStreaming) {
      inputRef.current?.focus();
    }
  }, [phase, isStreaming]);

  const handleSubmit = useCallback(
    (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || isStreaming) return;

      setCurrentPrompt(trimmed);
      setInputValue("");

      if (phase === "landing") {
        setPhase("loading");
        setTimeout(() => {
          send(trimmed);
          setPhase("active");
        }, 300);
      } else {
        clear();
        send(trimmed);
      }
    },
    [phase, isStreaming, send, clear]
  );

  const suggestions = [
    "Show me new pump.fun launches right now",
    "Search for $LUNCH ticker clones",
    "Analyze wallet 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU deep dive",
    "What meme narratives are accelerating now?",
    "Create a trust score with evidence links",
    "Build a share pack for a hot memecoin",
  ];

  // ─── Landing ────────────────────────────────────────────────────
  if (phase === "landing") {
    return (
      <div className="noise-bg relative h-screen overflow-y-auto custom-scrollbar px-4 pb-12 sm:px-6">
        {/* Dual ambient glow */}
        <div className="absolute top-1/4 left-1/3 w-[500px] h-[300px] bg-emerald-500/[0.04] rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute bottom-1/3 right-1/4 w-[400px] h-[250px] bg-cyan-500/[0.03] rounded-full blur-[120px] pointer-events-none" />

        <div className="relative z-20 mx-auto w-full max-w-6xl pt-5 sm:pt-6 animate-fade-in">
          <ViralCardNav items={landingLaneItems} onSelectPrompt={handleSubmit} />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-6xl space-y-9 pt-8 sm:pt-10">
          {/* Brand + tagline */}
          <div className="mx-auto max-w-2xl text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-zinc-800/80 bg-zinc-900/60 text-xs text-zinc-500">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              Live market intelligence
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-zinc-100 leading-[1.1]">
              Your edge,<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">
                visualized.
              </span>
            </h1>
            <p className="text-zinc-500 text-lg max-w-lg mx-auto leading-relaxed">
              Ask anything about meme tokens. Get instant dashboards, trust signals, and viral-ready intelligence.
            </p>
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit(inputValue);
            }}
            className="relative group mx-auto max-w-2xl"
          >
            <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 rounded-2xl blur opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
            <div className="relative">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="What alpha are you looking for?"
                autoFocus
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/80 backdrop-blur-sm px-6 py-4 pr-14 text-zinc-100 text-lg placeholder-zinc-600 focus:outline-none focus:border-zinc-700 transition-all"
              />
              <button
                type="submit"
                disabled={!inputValue.trim()}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-20 disabled:hover:bg-emerald-600 text-white transition-all"
                aria-label="Send"
              >
                <ArrowIcon size={20} />
              </button>
            </div>
          </form>

          {/* Suggestions */}
          <div className="mx-auto max-w-3xl flex flex-wrap justify-center gap-2">
            {suggestions.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => handleSubmit(text)}
                className="px-4 py-2 text-sm rounded-xl border border-zinc-800/70 bg-zinc-900/40 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/50 transition-all cursor-pointer"
              >
                {text}
              </button>
            ))}
          </div>

          <div className="mx-auto max-w-6xl space-y-4">
            <div className="text-center">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-600">
                Generation Modes
              </p>
              <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-100">
                One engine, tuned outputs for each job
              </h2>
            </div>

            <GenerationModeGrid
              modes={generationModes}
              onSelectPrompt={handleSubmit}
            />
          </div>
        </div>
      </div>
    );
  }

  // ─── Active ─────────────────────────────────────────────────────
  return (
    <div className="noise-bg h-screen flex flex-col relative">
      {/* Top bar */}
      <header className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-b border-zinc-800/40 bg-zinc-950/80 backdrop-blur-md z-20 animate-fade-in">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-sm font-medium text-zinc-500">Tickergeist</span>
        </div>
        <button
          type="button"
          onClick={() => {
            clear();
            setHistory([]);
            setPhase("landing");
            setCurrentPrompt("");
            setInputValue("");
          }}
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors px-3 py-1 rounded-lg hover:bg-zinc-900"
        >
          New session
        </button>
      </header>

      {/* Content */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto custom-scrollbar relative z-10"
      >
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-10 pb-36">
          {/* History */}
          {history.map((entry, i) => (
            <div key={i} className="space-y-3 animate-fade-in">
              <PromptBubble text={entry.prompt} />
              <div className="ml-9 rounded-2xl border border-zinc-800/50 bg-zinc-900/20 p-6">
                <Renderer
                  spec={entry.spec}
                  registry={registry}
                  loading={false}
                />
              </div>
            </div>
          ))}

          {/* Current stream */}
          {(isStreaming ||
            (spec && !history.some((h) => h.spec === spec))) && (
            <div className="space-y-3 animate-fade-in-up">
              <PromptBubble text={currentPrompt} />
              <div className="ml-9 rounded-2xl border border-zinc-800/50 bg-zinc-900/20 p-6">
                {!spec && isStreaming ? (
                  <LoadingDots />
                ) : (
                  <Renderer
                    spec={spec}
                    registry={registry}
                    loading={isStreaming}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating input */}
      <div className="absolute bottom-0 left-0 right-0 z-20 animate-slide-up">
        <div className="bg-gradient-to-t from-zinc-950 via-zinc-950/95 to-transparent pt-10 pb-6 px-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit(inputValue);
            }}
            className="max-w-3xl mx-auto relative"
          >
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={
                isStreaming
                  ? "Crunching data..."
                  : "Ask about any market, token, or trend..."
              }
              disabled={isStreaming}
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/90 backdrop-blur-md px-5 py-3.5 pr-14 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-zinc-700 disabled:opacity-50 transition-all shadow-lg shadow-black/30"
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isStreaming}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-20 disabled:hover:bg-emerald-600 text-white transition-all"
              aria-label="Send"
            >
              <ArrowIcon size={18} />
            </button>
          </form>
          {error && (
            <p className="max-w-3xl mx-auto mt-2 text-red-400/70 text-xs text-center">
              {error instanceof Error ? error.message : String(error)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Shared small components ─────────────────────────────────────── */

function PromptBubble({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center mt-0.5">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-zinc-500"
        >
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
      <p className="text-sm text-zinc-400 pt-0.5">{text}</p>
    </div>
  );
}

function LoadingDots() {
  return (
    <div className="flex items-center gap-3 py-8 justify-center">
      <div className="flex gap-1.5">
        {[0, 0.2, 0.4].map((delay) => (
          <span
            key={delay}
            className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse-glow"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </div>
      <span className="text-sm text-zinc-600">Scanning markets...</span>
    </div>
  );
}

function ArrowIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

/* ── Root ─────────────────────────────────────────────────────────── */

export default function Page() {
  return (
    <StateProvider initialState={initialData}>
      <VisibilityProvider>
        <ValidationProvider
          customFunctions={
            validators as Record<
              string,
              (value: unknown, args?: Record<string, unknown>) => boolean
            >
          }
        >
          <ActionProvider
            handlers={{
              submit: (params) => console.log("Submit:", params),
              navigate: (params) => {
                const url = (params as { url?: string })?.url;
                if (url) window.open(url, "_blank", "noopener,noreferrer");
              },
              copy: async (params) => {
                const text = (params as { text?: string })?.text;
                if (!text || typeof text !== "string") return;
                try {
                  await navigator.clipboard.writeText(text);
                } catch {
                  // best effort copy
                }
              },
            }}
          >
            <ChatApp />
          </ActionProvider>
        </ValidationProvider>
      </VisibilityProvider>
    </StateProvider>
  );
}
