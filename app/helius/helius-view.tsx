"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Renderer,
  StateProvider,
  ActionProvider,
  VisibilityProvider,
  ValidationProvider,
} from "@json-render/react";
import { registry } from "@/lib/registry";
import type { HeliusDashboardState } from "./use-helius-dashboard";
import type { TokenLookupResult } from "./types";
import {
  formatDate,
  formatDateFromMs,
  formatUsdCompact,
  toDisplayMediaUrl,
  shortSignature,
  SOLANA_EXPLORER,
  initialData,
  validators,
  toSpec,
} from "./utils";

interface HeliusViewProps extends HeliusDashboardState {}

type TokenSharePackResponse = {
  resultType: "tokenSharePack";
  summary: string;
  thread: string[];
  xIntentUrl: string;
  farcasterIntentUrl: string;
  imageCard: {
    title: string;
    subtitle: string;
    bullets: string[];
    cta: string;
    imageUrl?: string;
  };
  hypeVideo: {
    hook: string;
    timeline: unknown;
    promptTemplate: string;
  };
  video?: {
    renderEndpoint: string;
  };
};

type WatchlistItem = {
  id: string;
  ticker: string;
  active: boolean;
  web: boolean;
  telegramChatId?: string;
  discordWebhookUrl?: string;
};

type WatchAlertItem = {
  id: string;
  ticker: string;
  message: string;
  previousSuspicious: number;
  currentSuspicious: number;
  createdAt: number;
  channels: string[];
};

type MetaRadarCluster = {
  symbol: string;
  clusterScore: number;
  sampleSize: number;
  suspiciousRatio: number;
  acceleration: number;
  avgTrustScore?: number;
  summary: string;
};

function trustTone(grade: string | undefined): string {
  if (grade === "A") return "text-emerald-300";
  if (grade === "B") return "text-lime-300";
  if (grade === "C") return "text-amber-300";
  if (grade === "D") return "text-orange-300";
  return "text-red-300";
}

function dimensionBarColor(score: number, max: number): string {
  const pct = max > 0 ? score / max : 0;
  if (pct >= 0.75) return "bg-emerald-500";
  if (pct >= 0.5) return "bg-lime-500";
  if (pct >= 0.25) return "bg-amber-500";
  return "bg-red-500";
}

function toPercent(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "0.0%";
  return `${(value * 100).toFixed(1)}%`;
}

function getTimelineClipCount(timeline: unknown): number {
  if (!timeline || typeof timeline !== "object") return 0;
  const maybeClips = (timeline as { clips?: unknown }).clips;
  return Array.isArray(maybeClips) ? maybeClips.length : 0;
}

const LOOKUP_PLACEHOLDERS: Record<string, string> = {
  wallet: "e.g. 86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY",
  transaction: "Transaction signature (base58)",
  token: "Token mint or ticker (e.g. BONK)",
  nft: "NFT / asset ID",
};

export function HeliusView(props: HeliusViewProps) {
  const {
    lookupType,
    setLookupType,
    address,
    setAddress,
    loading,
    error,
    data,
    handleSubmit,
    loadDashboard,
    loadLookup,
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
    copyExportCode,
    requestViewUpdate,
    getActionHandlers,
    saveDashboard,
    restoreSavedDashboard,
    copyDashboardLink,
    canRestoreSaved,
  } = props;

  const tokenData = useMemo(
    () => (data?.resultType === "token" ? (data as TokenLookupResult) : null),
    [data]
  );
  const [userId, setUserId] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [sharePack, setSharePack] = useState<TokenSharePackResponse | null>(null);
  const [sharePackLoading, setSharePackLoading] = useState(false);
  const [sharePackError, setSharePackError] = useState<string | null>(null);
  const [shareVideoLoading, setShareVideoLoading] = useState(false);
  const [shareVideoError, setShareVideoError] = useState<string | null>(null);
  const [shareVideoDownloadUrl, setShareVideoDownloadUrl] = useState<string | null>(null);
  const [shareVideoMirrorStatusUrl, setShareVideoMirrorStatusUrl] = useState<string | null>(null);
  const [shareVideoMirrorState, setShareVideoMirrorState] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [watchAlerts, setWatchAlerts] = useState<WatchAlertItem[]>([]);
  const [watchLoading, setWatchLoading] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [telegramChatId, setTelegramChatId] = useState("");
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState("");
  const [metaRadar, setMetaRadar] = useState<MetaRadarCluster[]>([]);
  const [metaRadarLoading, setMetaRadarLoading] = useState(false);
  const [metaRadarError, setMetaRadarError] = useState<string | null>(null);

  const trackTelemetry = useCallback(
    (event: string, properties: Record<string, unknown> = {}) => {
      if (typeof window === "undefined") return;
      const payload = {
        event,
        userId: userId || undefined,
        sessionId: sessionId || undefined,
        page: "/helius",
        properties,
      };
      fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => undefined);
    },
    [sessionId, userId]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const uidKey = "helius:user-id";
    const sessionKey = "helius:session-id";
    const returnKey = "helius:returning";
    let uid = localStorage.getItem(uidKey);
    if (!uid) {
      uid = `u_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      localStorage.setItem(uidKey, uid);
    }
    let sid = localStorage.getItem(sessionKey);
    if (!sid) {
      sid = `s_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      localStorage.setItem(sessionKey, sid);
    }
    const returning = localStorage.getItem(returnKey) === "1";
    localStorage.setItem(returnKey, "1");
    setUserId(uid);
    setSessionId(sid);
    fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: returning ? "return_session" : "first_session",
        userId: uid,
        sessionId: sid,
        page: "/helius",
      }),
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!data) return;
    if (data.resultType === "token") {
      trackTelemetry("scan_token_lookup", {
        mint: data.id,
        symbol: data.symbol ?? "",
        sameTickerCount: data.sameTickerCount ?? data.sameTickerTokens?.length ?? 0,
        suspiciousTickerCount: data.suspiciousTickerCount ?? 0,
        trustScore: data.trustScore?.score ?? null,
      });
      return;
    }
    trackTelemetry("scan_lookup", { type: data.resultType });
  }, [data, trackTelemetry]);

  const loadSharePack = useCallback(
    async (token: TokenLookupResult) => {
      setSharePackLoading(true);
      setSharePackError(null);
      try {
        const res = await fetch("/api/helius/share-pack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const json = (await res.json()) as TokenSharePackResponse & { error?: string; details?: string };
        if (!res.ok) {
          throw new Error(json.details ?? json.error ?? `HTTP ${res.status}`);
        }
        setSharePack(json);
        trackTelemetry("share_pack_generated", {
          symbol: token.symbol ?? "",
          mint: token.id,
        });
      } catch (e) {
        setSharePackError(e instanceof Error ? e.message : String(e));
      } finally {
        setSharePackLoading(false);
      }
    },
    [trackTelemetry]
  );

  const refreshWatchlist = useCallback(async () => {
    if (!userId) return;
    setWatchLoading(true);
    setWatchError(null);
    try {
      const res = await fetch("/api/helius/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", userId }),
      });
      const json = (await res.json()) as { items?: WatchlistItem[]; error?: string; details?: string };
      if (!res.ok) {
        throw new Error(json.details ?? json.error ?? `HTTP ${res.status}`);
      }
      setWatchlist(json.items ?? []);
    } catch (e) {
      setWatchError(e instanceof Error ? e.message : String(e));
    } finally {
      setWatchLoading(false);
    }
  }, [userId]);

  const refreshWatchAlerts = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch("/api/helius/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "alerts", userId, limit: 20 }),
      });
      const json = (await res.json()) as { alerts?: WatchAlertItem[] };
      if (res.ok) setWatchAlerts(json.alerts ?? []);
    } catch {
      // best effort refresh
    }
  }, [userId]);

  const refreshMetaRadar = useCallback(async () => {
    setMetaRadarLoading(true);
    setMetaRadarError(null);
    try {
      const res = await fetch("/api/helius/meta-radar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 8 }),
      });
      const json = (await res.json()) as {
        clusters?: MetaRadarCluster[];
        error?: string;
        details?: string;
      };
      if (!res.ok) {
        throw new Error(json.details ?? json.error ?? `HTTP ${res.status}`);
      }
      setMetaRadar(json.clusters ?? []);
    } catch (e) {
      setMetaRadarError(e instanceof Error ? e.message : String(e));
    } finally {
      setMetaRadarLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!tokenData) {
      setSharePack(null);
      setSharePackError(null);
      setShareVideoError(null);
      setShareVideoDownloadUrl(null);
      setShareVideoMirrorStatusUrl(null);
      setShareVideoMirrorState(null);
      return;
    }
    setShareVideoError(null);
    setShareVideoDownloadUrl(null);
    setShareVideoMirrorStatusUrl(null);
    setShareVideoMirrorState(null);
    loadSharePack(tokenData);
  }, [loadSharePack, tokenData]);

  useEffect(() => {
    if (!userId) return;
    refreshWatchlist();
    refreshWatchAlerts();
  }, [userId, refreshWatchAlerts, refreshWatchlist]);

  useEffect(() => {
    if (!tokenData) return;
    refreshWatchAlerts();
    refreshMetaRadar();
  }, [tokenData, refreshMetaRadar, refreshWatchAlerts]);

  const watchedTicker = tokenData?.symbol?.trim().toUpperCase() ?? "";
  const watchedItem =
    watchlist.find((item) => item.active && item.ticker === watchedTicker) ?? null;

  useEffect(() => {
    if (!watchedItem) return;
    setTelegramChatId(watchedItem.telegramChatId ?? "");
    setDiscordWebhookUrl(watchedItem.discordWebhookUrl ?? "");
  }, [watchedItem]);

  const toggleWatchlist = useCallback(async () => {
    if (!userId || !tokenData?.symbol) return;
    const ticker = tokenData.symbol.trim().toUpperCase();
    setWatchLoading(true);
    setWatchError(null);
    try {
      const action = watchedItem ? "unsubscribe" : "subscribe";
      const res = await fetch("/api/helius/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          userId,
          ticker,
          mint: tokenData.id,
          channels: {
            web: true,
            telegramChatId: telegramChatId.trim() || undefined,
            discordWebhookUrl: discordWebhookUrl.trim() || undefined,
          },
        }),
      });
      const json = (await res.json()) as { error?: string; details?: string };
      if (!res.ok) {
        throw new Error(json.details ?? json.error ?? `HTTP ${res.status}`);
      }
      trackTelemetry(watchedItem ? "alert_unsubscribe" : "alert_subscribe", {
        ticker,
        mint: tokenData.id,
      });
      await Promise.all([refreshWatchlist(), refreshWatchAlerts()]);
    } catch (e) {
      setWatchError(e instanceof Error ? e.message : String(e));
    } finally {
      setWatchLoading(false);
    }
  }, [
    discordWebhookUrl,
    refreshWatchAlerts,
    refreshWatchlist,
    telegramChatId,
    tokenData,
    trackTelemetry,
    userId,
    watchedItem,
  ]);

  const copyShareThread = useCallback(async () => {
    if (!sharePack?.thread?.length) return;
    await navigator.clipboard.writeText(sharePack.thread.join("\n\n"));
    trackTelemetry("share_copy_thread", {
      symbol: tokenData?.symbol ?? "",
      mint: tokenData?.id ?? "",
    });
  }, [sharePack, tokenData, trackTelemetry]);

  const copyShareImageCard = useCallback(async () => {
    if (!sharePack?.imageCard) return;
    await navigator.clipboard.writeText(JSON.stringify(sharePack.imageCard, null, 2));
    trackTelemetry("share_copy_image_card", {
      symbol: tokenData?.symbol ?? "",
      mint: tokenData?.id ?? "",
    });
  }, [sharePack, tokenData, trackTelemetry]);

  const copyShareImageUrl = useCallback(async () => {
    if (!sharePack?.imageCard?.imageUrl) return;
    await navigator.clipboard.writeText(sharePack.imageCard.imageUrl);
    trackTelemetry("share_copy_image_url", {
      symbol: tokenData?.symbol ?? "",
      mint: tokenData?.id ?? "",
    });
  }, [sharePack, tokenData, trackTelemetry]);

  const copyShareVideoSpec = useCallback(async () => {
    if (!sharePack?.hypeVideo?.timeline) return;
    await navigator.clipboard.writeText(JSON.stringify(sharePack.hypeVideo.timeline, null, 2));
    trackTelemetry("share_copy_video_spec", {
      symbol: tokenData?.symbol ?? "",
      mint: tokenData?.id ?? "",
    });
  }, [sharePack, tokenData, trackTelemetry]);

  const copyShareVideoPrompt = useCallback(async () => {
    if (!sharePack?.hypeVideo?.promptTemplate) return;
    await navigator.clipboard.writeText(sharePack.hypeVideo.promptTemplate);
    trackTelemetry("share_copy_video_prompt", {
      symbol: tokenData?.symbol ?? "",
      mint: tokenData?.id ?? "",
    });
  }, [sharePack, tokenData, trackTelemetry]);

  const openShareX = useCallback(() => {
    if (!sharePack?.xIntentUrl) return;
    window.open(sharePack.xIntentUrl, "_blank", "noopener,noreferrer");
    trackTelemetry("share_open_x", {
      symbol: tokenData?.symbol ?? "",
      mint: tokenData?.id ?? "",
    });
  }, [sharePack, tokenData, trackTelemetry]);

  const openShareFarcaster = useCallback(() => {
    if (!sharePack?.farcasterIntentUrl) return;
    window.open(sharePack.farcasterIntentUrl, "_blank", "noopener,noreferrer");
    trackTelemetry("share_open_farcaster", {
      symbol: tokenData?.symbol ?? "",
      mint: tokenData?.id ?? "",
    });
  }, [sharePack, tokenData, trackTelemetry]);

  const renderShareVideo = useCallback(async () => {
    if (!tokenData) return;
    setShareVideoLoading(true);
    setShareVideoError(null);
    try {
      const endpoint = sharePack?.video?.renderEndpoint || "/api/share/video";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenData }),
      });
      const json = (await res.json()) as {
        downloadUrl?: string;
        previewUrl?: string;
        error?: string;
        details?: string;
        reusedCache?: boolean;
        convexMirror?: {
          enabled: boolean;
          jobId?: string;
          status?: string;
          statusUrl?: string;
          error?: string;
        };
      };
      if (!res.ok) {
        throw new Error(json.details ?? json.error ?? `HTTP ${res.status}`);
      }
      const downloadUrl = json.downloadUrl ?? json.previewUrl;
      if (!downloadUrl) {
        throw new Error("Renderer did not return a video URL");
      }
      setShareVideoDownloadUrl(downloadUrl);
      setShareVideoMirrorStatusUrl(json.convexMirror?.statusUrl ?? null);
      setShareVideoMirrorState(json.convexMirror?.status ?? null);
      if (json.convexMirror?.error) {
        setShareVideoError(`Convex mirror: ${json.convexMirror.error}`);
      }
      trackTelemetry("share_video_rendered", {
        symbol: tokenData.symbol ?? "",
        mint: tokenData.id,
        reusedCache: json.reusedCache ?? false,
        convexMirrorEnabled: json.convexMirror?.enabled ?? false,
        convexMirrorJobId: json.convexMirror?.jobId ?? null,
      });
    } catch (e) {
      setShareVideoError(e instanceof Error ? e.message : String(e));
    } finally {
      setShareVideoLoading(false);
    }
  }, [sharePack, tokenData, trackTelemetry]);

  useEffect(() => {
    if (!shareVideoMirrorStatusUrl) return;
    let cancelled = false;
    let intervalRef: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(shareVideoMirrorStatusUrl, { cache: "no-store" });
        const json = (await res.json()) as {
          job?: {
            status?: string;
            r2Url?: string;
            jobId?: string;
            error?: string;
          };
        };
        if (!res.ok || !json.job) return;
        const status = json.job.status ?? "processing";
        setShareVideoMirrorState(status);

        if (status === "mirrored" && json.job.r2Url) {
          setShareVideoDownloadUrl(json.job.r2Url);
          setShareVideoMirrorStatusUrl(null);
          setShareVideoError(null);
          trackTelemetry("share_video_mirrored_r2", {
            symbol: tokenData?.symbol ?? "",
            mint: tokenData?.id ?? "",
            jobId: json.job.jobId ?? "",
          });
          if (intervalRef) clearInterval(intervalRef);
          return;
        }

        if (status === "failed") {
          setShareVideoError(json.job.error ?? "Convex mirror failed");
          setShareVideoMirrorStatusUrl(null);
          if (intervalRef) clearInterval(intervalRef);
        }
      } catch {
        // best effort polling
      }
    };

    void poll();
    intervalRef = setInterval(() => {
      void poll();
    }, 4_000);

    return () => {
      cancelled = true;
      if (intervalRef) clearInterval(intervalRef);
    };
  }, [shareVideoMirrorStatusUrl, tokenData, trackTelemetry]);

  return (
    <main className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-zinc-100 mb-2">
        Helius Lookup &amp; Dashboards
      </h1>
      <p className="text-zinc-400 mb-6">
        Look up a wallet, transaction, token, or NFT on Solana. View data (with optional Allium enrichment), then generate an AI dashboard and refine it in plain language.
      </p>

      <section aria-label="Step 1: Choose type and enter id" className="mb-8">
        <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wide mb-2">Step 1 — Look up</h2>
        <form
          onSubmit={handleSubmit}
          className="flex flex-wrap items-center gap-3 mb-2"
        >
          <select
            value={lookupType}
            onChange={(e) => setLookupType(e.target.value as "wallet" | "transaction" | "token" | "nft")}
            className="border border-zinc-600 rounded-lg bg-zinc-900 px-3 py-2.5 text-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            aria-label="Lookup type"
          >
            <option value="wallet">Wallet</option>
            <option value="transaction">Transaction</option>
            <option value="token">Token</option>
            <option value="nft">NFT</option>
          </select>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={LOOKUP_PLACEHOLDERS[lookupType] ?? LOOKUP_PLACEHOLDERS.wallet}
            className="flex-1 min-w-[240px] border border-zinc-600 rounded-lg bg-zinc-900 px-4 py-2.5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm"
            aria-describedby="lookup-hint"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            aria-busy={loading}
            aria-disabled={loading}
          >
            {loading ? "Loading…" : "Look up"}
          </button>
        </form>
        <p id="lookup-hint" className="text-zinc-500 text-sm">Powered by <a href="https://www.helius.dev/docs" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Helius</a>. Optional <a href="https://docs.allium.so/" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Allium</a> enrichment for addresses.</p>
      </section>

      <div role="alert" aria-live="assertive" aria-atomic="true" className="min-h-[2rem]">
        {error && (
          <div className="mb-6 p-4 rounded-xl border border-red-800 bg-red-950/30 text-red-300 flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => loadLookup(lookupType, address)}
              className="px-3 py-1.5 bg-red-800/50 hover:bg-red-800 text-white rounded-lg text-sm font-medium"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {loading && !data && (
        <div className="space-y-8 animate-pulse" aria-busy="true" aria-label="Loading dashboard">
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-5">
                <div className="h-4 bg-zinc-700 rounded w-24 mb-3" />
                <div className="h-8 bg-zinc-700 rounded w-32" />
              </div>
            ))}
          </section>
          <section>
            <div className="h-5 bg-zinc-700 rounded w-40 mb-3" />
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 h-32" />
          </section>
          <section>
            <div className="h-5 bg-zinc-700 rounded w-48 mb-3" />
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 h-64" />
          </section>
        </div>
      )}

      {data && data.resultType === "transaction" && (
        <section aria-label="Step 2: Transaction result" className="space-y-6">
          <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wide">Step 2 — Transaction</h2>
          {(data.description ?? data.type) && (
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-4">
              {data.description && <p className="text-zinc-200 mb-1">{data.description}</p>}
              <div className="flex flex-wrap gap-2 text-sm">
                {data.type && <span className="text-zinc-400">Type: <span className="text-emerald-300">{data.type}</span></span>}
                {data.source && <span className="text-zinc-400">Source: <span className="text-zinc-300">{data.source}</span></span>}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-5">
              <p className="text-zinc-500 text-sm uppercase tracking-wide mb-1">Slot</p>
              <p className="text-2xl font-bold text-zinc-100">{data.slot}</p>
            </div>
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-5">
              <p className="text-zinc-500 text-sm uppercase tracking-wide mb-1">Fee</p>
              <p className="text-2xl font-bold text-zinc-100">{data.fee != null ? `${data.fee} lamports` : "—"}</p>
            </div>
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-5">
              <p className="text-zinc-500 text-sm uppercase tracking-wide mb-1">Status</p>
              <p className="text-2xl font-bold text-zinc-100">{data.err ? "Failed" : "Success"}</p>
            </div>
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-5">
              <p className="text-zinc-500 text-sm uppercase tracking-wide mb-1">Block time</p>
              <p className="text-lg font-semibold text-zinc-100">{data.blockTime != null ? formatDate(data.blockTime) : "—"}</p>
            </div>
          </div>
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-4 font-mono text-sm text-zinc-300 break-all">
            <span className="text-zinc-500">Signature: </span>
            {data.signature}
          </div>
          {data.feePayer && (
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-4 font-mono text-sm text-zinc-300 break-all">
              <span className="text-zinc-500">Fee payer: </span>
              <a href={`${SOLANA_EXPLORER}/address/${data.feePayer}`} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">{data.feePayer}</a>
            </div>
          )}
          {data.alliumEnrichment && (
            <section aria-label="Allium enrichment" className="rounded-xl border border-indigo-800/60 bg-indigo-950/20 p-4">
              <h3 className="text-sm font-semibold text-indigo-200 mb-2">Enriched by Allium (fee payer)</h3>
              <div className="flex flex-wrap gap-4 text-sm">
                {data.alliumEnrichment.totalTxCount != null && <span className="text-indigo-300">Total txs: {data.alliumEnrichment.totalTxCount.toLocaleString()}</span>}
                {data.alliumEnrichment.chains && data.alliumEnrichment.chains.length > 0 && <span className="text-indigo-300">Chains: {data.alliumEnrichment.chains.join(", ")}</span>}
                {data.alliumEnrichment.labels && data.alliumEnrichment.labels.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {data.alliumEnrichment.labels.map((l) => (
                      <span key={l} className="px-2 py-0.5 rounded bg-indigo-800/50 text-indigo-200 text-xs">{l}</span>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
          <a href={`${SOLANA_EXPLORER}/tx/${data.signature}`} target="_blank" rel="noopener noreferrer" className="inline-block text-emerald-400 hover:underline text-sm">View on Solana Explorer →</a>
          <section className="rounded-xl border border-zinc-700/50 bg-zinc-900/20 p-4 mt-4">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Data &amp; analytics</h3>
            <p className="text-zinc-500 text-sm mb-2">
              For multi-chain analytics, SQL, and realtime APIs see <a href="https://docs.allium.so/" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Allium</a>.
            </p>
            <a href="https://app.allium.so/join" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white transition-colors">Get Allium access →</a>
          </section>
        </section>
      )}

      {data && data.resultType === "token" && (
        <section aria-label="Step 2: Token result" className="space-y-6">
          <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wide">Step 2 — Token</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-5">
              <p className="text-zinc-500 text-sm uppercase tracking-wide mb-1">Name</p>
              <p className="text-xl font-bold text-zinc-100">{data.name ?? "—"}</p>
            </div>
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-5">
              <p className="text-zinc-500 text-sm uppercase tracking-wide mb-1">Symbol</p>
              <p className="text-xl font-bold text-zinc-100">{data.symbol ?? "—"}</p>
            </div>
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-5">
              <p className="text-zinc-500 text-sm uppercase tracking-wide mb-1">Decimals</p>
              <p className="text-xl font-bold text-zinc-100">{data.decimals ?? "—"}</p>
            </div>
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-5">
              <p className="text-zinc-500 text-sm uppercase tracking-wide mb-1">Image sources</p>
              <p className="text-xl font-bold text-zinc-100">{data.imageUris?.length ?? (data.imageUri ? 1 : 0)}</p>
            </div>
          </div>
          <div className="rounded-xl border border-amber-800/60 bg-amber-950/20 p-4">
            <p className="text-amber-200 text-sm font-semibold mb-1">
              Same-ticker scan (anti-fake check)
            </p>
            <p className="text-amber-100/90 text-sm">
              Query mode:{" "}
              <span className="font-mono text-amber-200">
                {data.lookupMode === "ticker" ? "ticker" : "mint"}
              </span>
              {" · "}
              Ticker:{" "}
              <span className="font-mono text-amber-200">
                {data.searchedTicker ?? data.symbol ?? "—"}
              </span>
              {" · "}
              Matches on Solana:{" "}
              <span className="font-mono text-amber-200">
                {data.sameTickerCount ?? data.sameTickerTokens?.length ?? 0}
              </span>
              {" · "}
              Medium/High risk matches:{" "}
              <span className="font-mono text-amber-200">
                {data.suspiciousTickerCount ?? 0}
              </span>
              {" · "}
              Images collected:{" "}
              <span className="font-mono text-amber-200">
                {data.sameTickerImageCount ?? data.imageUris?.length ?? 0}
              </span>
            </p>
          </div>

          {data.trustScore && (
            <section className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-emerald-200">Trust Score</h3>
                  <p className="text-emerald-100/80 text-sm">
                    Multi-dimensional scoring: identity, liquidity, volume, trading health, and maturity.
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-3xl font-bold ${trustTone(data.trustScore.grade)}`}>
                    {data.trustScore.score}
                    <span className="text-zinc-400 text-xl">/100</span>
                  </p>
                  <p className="text-zinc-400 text-sm">Grade {data.trustScore.grade}</p>
                </div>
              </div>

              {data.trustScore.dimensions && data.trustScore.dimensions.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  {data.trustScore.dimensions.map((dim) => (
                    <div
                      key={dim.key}
                      className="rounded-lg border border-zinc-700/70 bg-zinc-900/60 p-3"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-zinc-300 text-xs font-medium truncate">{dim.label}</p>
                        <p className="text-zinc-200 text-xs font-bold ml-2 shrink-0">
                          {dim.score}/{dim.maxScore}
                        </p>
                      </div>
                      <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${dimensionBarColor(dim.score, dim.maxScore)}`}
                          style={{ width: `${dim.maxScore > 0 ? (dim.score / dim.maxScore) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {data.trustScore.dimensions && data.trustScore.dimensions.length > 0 ? (
                <div className="space-y-3">
                  {data.trustScore.dimensions.map((dim) => (
                    <details key={dim.key} className="group">
                      <summary className="cursor-pointer flex items-center gap-2 text-sm text-zinc-300 hover:text-zinc-100 transition-colors">
                        <span className="text-zinc-500 group-open:rotate-90 transition-transform">&#9654;</span>
                        <span className="font-medium">{dim.label}</span>
                        <span className={`ml-auto text-xs font-bold ${
                          dim.maxScore > 0 && dim.score / dim.maxScore >= 0.75
                            ? "text-emerald-300"
                            : dim.maxScore > 0 && dim.score / dim.maxScore >= 0.5
                              ? "text-lime-300"
                              : dim.maxScore > 0 && dim.score / dim.maxScore >= 0.25
                                ? "text-amber-300"
                                : "text-red-300"
                        }`}>
                          {dim.score}/{dim.maxScore}
                        </span>
                      </summary>
                      <ul className="mt-2 ml-4 space-y-1.5">
                        {dim.reasons.map((reason) => (
                          <li
                            key={reason.key}
                            className="rounded-lg border border-zinc-700/50 bg-zinc-900/40 p-2.5"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-0.5">
                              <p className="text-zinc-200 text-sm font-medium">{reason.label}</p>
                              <p className={`text-xs font-bold ${reason.impact > 0 ? "text-emerald-300" : reason.impact < 0 ? "text-red-300" : "text-zinc-500"}`}>
                                {reason.impact > 0 ? "+" : ""}
                                {reason.impact}
                              </p>
                            </div>
                            <p className="text-zinc-400 text-xs">{reason.detail}</p>
                            {reason.link && (
                              <a
                                href={reason.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-block mt-1.5 text-xs text-emerald-400 hover:underline"
                              >
                                Source link →
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              ) : data.trustScore.reasons.length > 0 ? (
                <ul className="space-y-2">
                  {data.trustScore.reasons.map((reason) => (
                    <li
                      key={reason.key}
                      className="rounded-lg border border-zinc-700/70 bg-zinc-900/60 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <p className="text-zinc-200 font-medium">{reason.label}</p>
                        <p className={reason.impact >= 0 ? "text-emerald-300" : "text-red-300"}>
                          {reason.impact > 0 ? "+" : ""}
                          {reason.impact}
                        </p>
                      </div>
                      <p className="text-zinc-400 text-sm">{reason.detail}</p>
                      {reason.link && (
                        <a
                          href={reason.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block mt-2 text-xs text-emerald-400 hover:underline"
                        >
                          Source link →
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <a
                  href={data.trustScore.hardLinks.mint}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 text-sm rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-800"
                >
                  Mint
                </a>
                {data.trustScore.hardLinks.pair && (
                  <a
                    href={data.trustScore.hardLinks.pair}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-sm rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-800"
                  >
                    Pair
                  </a>
                )}
                {data.trustScore.hardLinks.tx && (
                  <a
                    href={data.trustScore.hardLinks.tx}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-sm rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-800"
                  >
                    Transactions
                  </a>
                )}
                {data.trustScore.hardLinks.liquidity && (
                  <a
                    href={data.trustScore.hardLinks.liquidity}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-sm rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-800"
                  >
                    Liquidity
                  </a>
                )}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-fuchsia-800/50 bg-fuchsia-950/15 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-fuchsia-200">Share Pack</h3>
                <p className="text-fuchsia-100/80 text-sm">
                  One-click social thread, image card payload, and hype video timeline.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyShareThread()}
                  disabled={!sharePack || sharePackLoading}
                  className="px-3 py-1.5 text-sm rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                >
                  Copy thread
                </button>
                <button
                  type="button"
                  onClick={openShareX}
                  disabled={!sharePack?.xIntentUrl || sharePackLoading}
                  className="px-3 py-1.5 text-sm rounded-lg bg-black hover:bg-zinc-900 text-white disabled:opacity-50"
                >
                  Open X
                </button>
                <button
                  type="button"
                  onClick={openShareFarcaster}
                  disabled={!sharePack?.farcasterIntentUrl || sharePackLoading}
                  className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white disabled:opacity-50"
                >
                  Open Farcaster
                </button>
              </div>
            </div>
            {sharePackLoading && (
              <p className="text-zinc-400 text-sm">Generating share pack…</p>
            )}
            {sharePackError && (
              <p className="text-red-300 text-sm">Share pack error: {sharePackError}</p>
            )}
            {sharePack && (
              <>
                <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
                  <p className="text-zinc-300 text-sm font-medium mb-2">Thread Draft</p>
                  <div className="space-y-2">
                    {sharePack.thread.map((line, idx) => (
                      <p key={`${line}-${idx}`} className="text-zinc-300 text-sm">
                        {idx + 1}. {line}
                      </p>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
                    <p className="text-zinc-300 text-sm font-medium mb-2">Image Card Payload</p>
                    <p className="text-zinc-200 font-semibold">{sharePack.imageCard.title}</p>
                    <p className="text-zinc-400 text-sm mb-2">{sharePack.imageCard.subtitle}</p>
                    {sharePack.imageCard.imageUrl && (
                      <a
                        href={sharePack.imageCard.imageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-lg overflow-hidden border border-zinc-700 mb-2"
                      >
                        <img
                          src={sharePack.imageCard.imageUrl}
                          alt={`${tokenData?.symbol ?? "token"} share card`}
                          className="w-full h-40 object-cover"
                        />
                      </a>
                    )}
                    <ul className="space-y-1">
                      {sharePack.imageCard.bullets.map((bullet, idx) => (
                        <li key={`${bullet}-${idx}`} className="text-xs text-zinc-400">
                          • {bullet}
                        </li>
                      ))}
                    </ul>
                    <p className="text-emerald-300 text-xs mt-2">{sharePack.imageCard.cta}</p>
                    <button
                      type="button"
                      onClick={() => void copyShareImageCard()}
                      className="mt-3 px-3 py-1.5 text-sm rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-800"
                    >
                      Copy image card JSON
                    </button>
                    {sharePack.imageCard.imageUrl && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => void copyShareImageUrl()}
                          className="px-3 py-1.5 text-sm rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-800"
                        >
                          Copy image URL
                        </button>
                        <a
                          href={sharePack.imageCard.imageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 text-sm rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-800"
                        >
                          Open image
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
                    <p className="text-zinc-300 text-sm font-medium mb-2">Hype Video Pack</p>
                    <p className="text-zinc-200 text-sm">{sharePack.hypeVideo.hook}</p>
                    <p className="text-zinc-500 text-xs mt-1">
                      Timeline clips: {getTimelineClipCount(sharePack.hypeVideo.timeline)}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => void copyShareVideoSpec()}
                        className="px-3 py-1.5 text-sm rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-800"
                      >
                        Copy video JSON
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyShareVideoPrompt()}
                        className="px-3 py-1.5 text-sm rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-800"
                      >
                        Copy video prompt
                      </button>
                      <button
                        type="button"
                        onClick={() => void renderShareVideo()}
                        disabled={shareVideoLoading}
                        className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600/90 hover:bg-emerald-600 text-white disabled:opacity-50"
                      >
                        {shareVideoLoading ? "Rendering MP4..." : "Render MP4"}
                      </button>
                    </div>
                    {shareVideoError && (
                      <p className="text-red-300 text-xs mt-2">Video render error: {shareVideoError}</p>
                    )}
                    {shareVideoMirrorState && (
                      <p className="text-zinc-400 text-xs mt-2">
                        Convex mirror: <span className="text-zinc-300">{shareVideoMirrorState}</span>
                        {shareVideoMirrorState === "mirrored" && " (durable R2 URL active)"}
                      </p>
                    )}
                    {shareVideoDownloadUrl && (
                      <a
                        href={shareVideoDownloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block mt-2 text-emerald-400 hover:underline text-sm"
                      >
                        Download MP4 →
                      </a>
                    )}
                    <p className="text-zinc-500 text-xs mt-3 whitespace-pre-wrap">
                      {sharePack.hypeVideo.promptTemplate}
                    </p>
                  </div>
                </div>
              </>
            )}
          </section>

          <section className="rounded-xl border border-cyan-800/50 bg-cyan-950/15 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-cyan-200">Watchlists + Alerts</h3>
                <p className="text-cyan-100/80 text-sm">
                  Alert me when new suspicious clones appear for this ticker.
                </p>
              </div>
              <span
                className={`text-xs px-2 py-1 rounded ${
                  watchedItem ? "bg-emerald-900/40 text-emerald-300" : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {watchedItem ? "Subscribed" : "Not subscribed"}
              </span>
            </div>
            {tokenData?.symbol ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="text-sm text-zinc-400">
                    Telegram chat ID
                    <input
                      type="text"
                      value={telegramChatId}
                      onChange={(e) => setTelegramChatId(e.target.value)}
                      placeholder="Optional chat id"
                      className="mt-1 w-full border border-zinc-600 rounded-lg bg-zinc-900 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    />
                  </label>
                  <label className="text-sm text-zinc-400">
                    Discord webhook URL
                    <input
                      type="text"
                      value={discordWebhookUrl}
                      onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                      placeholder="Optional webhook URL"
                      className="mt-1 w-full border border-zinc-600 rounded-lg bg-zinc-900 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void toggleWatchlist()}
                    disabled={watchLoading}
                    className={`px-3 py-1.5 text-sm rounded-lg font-medium text-white disabled:opacity-50 ${
                      watchedItem
                        ? "bg-red-600/90 hover:bg-red-600"
                        : "bg-cyan-600/90 hover:bg-cyan-600"
                    }`}
                  >
                    {watchLoading
                      ? "Updating…"
                      : watchedItem
                        ? `Unsubscribe ${tokenData.symbol.toUpperCase()}`
                        : `Subscribe ${tokenData.symbol.toUpperCase()}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void Promise.all([refreshWatchlist(), refreshWatchAlerts()]);
                    }}
                    className="px-3 py-1.5 text-sm rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-800"
                  >
                    Refresh alerts
                  </button>
                </div>
                {watchError && <p className="text-red-300 text-sm">Watchlist error: {watchError}</p>}
                <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
                  <p className="text-zinc-300 text-sm font-medium mb-2">Recent Alerts</p>
                  {watchAlerts.length === 0 ? (
                    <p className="text-zinc-500 text-sm">No alerts yet for this user.</p>
                  ) : (
                    <div className="space-y-2">
                      {watchAlerts.slice(0, 8).map((alert) => (
                        <div
                          key={alert.id}
                          className="rounded-lg border border-zinc-700/60 bg-zinc-900/70 p-2"
                        >
                          <p className="text-zinc-200 text-sm">{alert.message}</p>
                          <p className="text-zinc-500 text-xs mt-1">
                            {new Date(alert.createdAt).toLocaleString()} · channels:{" "}
                            {alert.channels.join(", ") || "web"}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-zinc-500 text-sm">
                Watchlists are available after a token symbol is identified.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-indigo-800/50 bg-indigo-950/15 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-indigo-200">Meta Radar</h3>
                <p className="text-indigo-100/80 text-sm">
                  Convex RAG feed showing which ticker narratives are accelerating.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshMetaRadar()}
                disabled={metaRadarLoading}
                className="px-3 py-1.5 text-sm rounded-lg border border-zinc-600 text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
              >
                {metaRadarLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            {metaRadarError && (
              <p className="text-red-300 text-sm">Meta Radar unavailable: {metaRadarError}</p>
            )}
            {metaRadar.length === 0 ? (
              <p className="text-zinc-500 text-sm">No meta clusters available yet.</p>
            ) : (
              <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-700 text-left text-zinc-500">
                        <th className="p-3 font-medium">Ticker</th>
                        <th className="p-3 font-medium">Score</th>
                        <th className="p-3 font-medium">Suspicious Ratio</th>
                        <th className="p-3 font-medium">Acceleration</th>
                        <th className="p-3 font-medium">Sample</th>
                        <th className="p-3 font-medium">Avg Trust</th>
                        <th className="p-3 font-medium">Narrative</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metaRadar.slice(0, 8).map((cluster) => (
                        <tr key={cluster.symbol} className="border-b border-zinc-800 hover:bg-zinc-800/50">
                          <td className="p-3 text-zinc-200 font-semibold">{cluster.symbol}</td>
                          <td className="p-3 text-zinc-300">{cluster.clusterScore.toFixed(2)}</td>
                          <td className="p-3 text-zinc-300">{toPercent(cluster.suspiciousRatio)}</td>
                          <td className="p-3 text-zinc-300">{cluster.acceleration}</td>
                          <td className="p-3 text-zinc-300">{cluster.sampleSize}</td>
                          <td className="p-3 text-zinc-300">
                            {cluster.avgTrustScore != null ? `${cluster.avgTrustScore.toFixed(1)}` : "n/a"}
                          </td>
                          <td className="p-3 text-zinc-400 max-w-[320px] truncate" title={cluster.summary}>
                            {cluster.summary}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-4 font-mono text-sm text-zinc-300 break-all">
            <span className="text-zinc-500">Mint / ID: </span>
            {data.id}
          </div>
          <a href={`${SOLANA_EXPLORER}/address/${data.id}`} target="_blank" rel="noopener noreferrer" className="inline-block text-emerald-400 hover:underline text-sm">View on Solana Explorer →</a>

          {data.imageUris && data.imageUris.length > 0 && (
            <section className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-4">
              <h3 className="text-lg font-semibold text-zinc-200 mb-3">
                Token images ({data.imageUris.length})
              </h3>
              <div className="flex flex-wrap gap-3">
                {data.imageUris.slice(0, 20).map((uri) => (
                  <a
                    key={uri}
                    href={uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group rounded-lg border border-zinc-700 bg-zinc-900/70 overflow-hidden w-24 h-24 flex items-center justify-center"
                    title={uri}
                  >
                    <img
                      src={toDisplayMediaUrl(uri)}
                      alt={data.symbol ?? data.id}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  </a>
                ))}
              </div>
              {data.imageUris.length > 20 && (
                <p className="text-xs text-zinc-500 mt-3">
                  Showing 20 of {data.imageUris.length} image URLs.
                </p>
              )}
            </section>
          )}

          {data.sameTickerTokens && data.sameTickerTokens.length > 0 && (
            <section>
              <h3 className="text-lg font-semibold text-zinc-200 mb-3">
                Tokens with same ticker on Solana ({data.sameTickerTokens.length})
              </h3>
              <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-700 text-left text-zinc-500">
                        <th className="p-3 font-medium">Token</th>
                        <th className="p-3 font-medium">Mint</th>
                        <th className="p-3 font-medium">Risk</th>
                        <th className="p-3 font-medium">Liquidity</th>
                        <th className="p-3 font-medium">24h Vol</th>
                        <th className="p-3 font-medium">FDV</th>
                        <th className="p-3 font-medium">Imgs</th>
                        <th className="p-3 font-medium">Pairs</th>
                        <th className="p-3 font-medium">Created</th>
                        <th className="p-3 font-medium">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sameTickerTokens.map((t) => {
                        const riskTone =
                          t.risk === "canonical"
                            ? "text-emerald-300"
                            : t.risk === "high"
                              ? "text-red-300"
                              : t.risk === "medium"
                                ? "text-amber-300"
                                : "text-zinc-300";
                        return (
                          <tr
                            key={`${t.mint}-${t.pairAddress ?? "na"}`}
                            className="border-b border-zinc-800 hover:bg-zinc-800/50"
                          >
                            <td className="p-3">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-md overflow-hidden border border-zinc-700 bg-zinc-800 flex items-center justify-center flex-shrink-0">
                                  {t.imageUri ? (
                                    <img src={toDisplayMediaUrl(t.imageUri)} alt={t.symbol} className="w-full h-full object-cover" />
                                  ) : (
                                    <span className="text-[10px] text-zinc-500">No img</span>
                                  )}
                                </div>
                                <div>
                                  <div className="text-zinc-200 font-medium">
                                    {t.symbol}
                                    {t.name ? ` · ${t.name}` : ""}
                                  </div>
                                  <div className="text-xs text-zinc-500">
                                    {t.riskReasons.join(", ")}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="p-3 font-mono text-zinc-300 text-xs">
                              <a
                                href={`${SOLANA_EXPLORER}/address/${t.mint}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-emerald-400 hover:underline"
                                title={t.mint}
                              >
                                {shortSignature(t.mint)}
                              </a>
                            </td>
                            <td className={`p-3 font-semibold uppercase ${riskTone}`}>
                              {t.risk}
                            </td>
                            <td className="p-3 text-zinc-300">{formatUsdCompact(t.liquidityUsd)}</td>
                            <td className="p-3 text-zinc-300">{formatUsdCompact(t.volume24hUsd)}</td>
                            <td className="p-3 text-zinc-300">{formatUsdCompact(t.fdvUsd)}</td>
                            <td className="p-3 text-zinc-300">
                              {t.imageUris?.length ?? (t.imageUri ? 1 : 0)}
                            </td>
                            <td className="p-3 text-zinc-300">{t.pairCount}</td>
                            <td className="p-3 text-zinc-400">{formatDateFromMs(t.pairCreatedAt)}</td>
                            <td className="p-3">
                              {t.url ? (
                                <a
                                  href={t.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-emerald-400 hover:underline"
                                >
                                  Dex
                                </a>
                              ) : (
                                <span className="text-zinc-500">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          <section className="rounded-xl border border-zinc-700/50 bg-zinc-900/20 p-4 mt-4">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Data &amp; analytics</h3>
            <p className="text-zinc-500 text-sm mb-2">
              For multi-chain analytics, SQL, and realtime APIs see <a href="https://docs.allium.so/" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Allium</a>.
            </p>
            <a href="https://app.allium.so/join" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white transition-colors">Get Allium access →</a>
          </section>
        </section>
      )}

      {data && data.resultType === "nft" && (
        <section aria-label="Step 2: NFT result" className="space-y-6">
          <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wide">Step 2 — NFT</h2>
          <div className="flex flex-wrap gap-6 items-start">
            {data.imageUri && (
              <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 overflow-hidden w-48 h-48 flex-shrink-0">
                <img src={data.imageUri} alt={data.name ?? data.id} className="w-full h-full object-cover" />
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-4">
              <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-5">
                <p className="text-zinc-500 text-sm uppercase tracking-wide mb-1">Name</p>
                <p className="text-xl font-bold text-zinc-100">{data.name ?? "—"}</p>
              </div>
              <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-5">
                <p className="text-zinc-500 text-sm uppercase tracking-wide mb-1">Symbol</p>
                <p className="text-xl font-bold text-zinc-100">{data.symbol ?? "—"}</p>
              </div>
              {data.interface && (
                <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-5">
                  <p className="text-zinc-500 text-sm uppercase tracking-wide mb-1">Interface</p>
                  <p className="text-zinc-200 font-mono">{data.interface}</p>
                </div>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-4 font-mono text-sm text-zinc-300 break-all">
            <span className="text-zinc-500">Asset ID: </span>
            {data.id}
          </div>
          <a href={`${SOLANA_EXPLORER}/address/${data.id}`} target="_blank" rel="noopener noreferrer" className="inline-block text-emerald-400 hover:underline text-sm">View on Solana Explorer →</a>
          <section className="rounded-xl border border-zinc-700/50 bg-zinc-900/20 p-4 mt-4">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Data &amp; analytics</h3>
            <p className="text-zinc-500 text-sm mb-2">
              For multi-chain analytics, SQL, and realtime APIs see <a href="https://docs.allium.so/" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Allium</a>.
            </p>
            <a href="https://app.allium.so/join" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white transition-colors">Get Allium access →</a>
          </section>
        </section>
      )}

      {data && data.resultType === "wallet" && (
        <section aria-label="Step 2: Dashboard results" className="space-y-8">
          <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wide">Step 2 — Dashboard</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-5">
              <p className="text-zinc-500 text-sm uppercase tracking-wide mb-1">SOL Balance</p>
              <p className="text-2xl font-bold text-zinc-100">{data.solBalance.toFixed(4)} SOL</p>
              <p className="text-zinc-500 text-xs mt-1">{data.solBalanceLamports.toLocaleString()} lamports</p>
            </div>
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-5">
              <p className="text-zinc-500 text-sm uppercase tracking-wide mb-1">Recent txs</p>
              <p className="text-2xl font-bold text-zinc-100">{data.transactionCount}</p>
              <p className="text-zinc-500 text-xs mt-1">last 25</p>
            </div>
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-5">
              <p className="text-zinc-500 text-sm uppercase tracking-wide mb-1">Token accounts</p>
              <p className="text-2xl font-bold text-zinc-100">{data.tokenCount}</p>
            </div>
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-5">
              <p className="text-zinc-500 text-sm uppercase tracking-wide mb-1">NFTs / assets</p>
              <p className="text-2xl font-bold text-zinc-100">{data.nftCount}</p>
            </div>
          </div>

          <section>
            <h2 className="text-lg font-semibold text-zinc-200 mb-3">Wallet</h2>
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-4 font-mono text-sm text-zinc-300 break-all">
              {data.address}
            </div>
            <a
              href={`${SOLANA_EXPLORER}/address/${data.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 text-emerald-400 hover:underline text-sm"
            >
              View on Solana Explorer →
            </a>
          </section>

          {data.alliumEnrichment && (
            <section aria-label="Allium enrichment" className="rounded-xl border border-indigo-800/60 bg-indigo-950/20 p-4">
              <h2 className="text-lg font-semibold text-indigo-200 mb-2 flex items-center gap-2">
                Enriched by Allium
              </h2>
              <p className="text-indigo-300/90 text-sm mb-3">
                Multi-chain and analytics data from <a href="https://docs.allium.so/" target="_blank" rel="noopener noreferrer" className="underline">Allium</a>.
              </p>
              <div className="flex flex-wrap gap-4 text-sm">
                {data.alliumEnrichment.totalTxCount != null && (
                  <div>
                    <span className="text-indigo-400/80">Total txs</span>
                    <span className="ml-2 font-mono text-indigo-100">{data.alliumEnrichment.totalTxCount.toLocaleString()}</span>
                  </div>
                )}
                {data.alliumEnrichment.firstSeen && (
                  <div>
                    <span className="text-indigo-400/80">First seen</span>
                    <span className="ml-2 text-indigo-100">{new Date(data.alliumEnrichment.firstSeen).toLocaleDateString()}</span>
                  </div>
                )}
                {data.alliumEnrichment.lastActive && (
                  <div>
                    <span className="text-indigo-400/80">Last active</span>
                    <span className="ml-2 text-indigo-100">{new Date(data.alliumEnrichment.lastActive).toLocaleDateString()}</span>
                  </div>
                )}
                {data.alliumEnrichment.chains && data.alliumEnrichment.chains.length > 0 && (
                  <div>
                    <span className="text-indigo-400/80">Chains</span>
                    <span className="ml-2 text-indigo-100">{data.alliumEnrichment.chains.join(", ")}</span>
                  </div>
                )}
                {data.alliumEnrichment.labels && data.alliumEnrichment.labels.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {data.alliumEnrichment.labels.map((l) => (
                      <span key={l} className="px-2 py-0.5 rounded bg-indigo-800/50 text-indigo-200 text-xs">{l}</span>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-zinc-700/50 bg-zinc-900/20 p-4">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Data &amp; analytics</h3>
            <p className="text-zinc-500 text-sm mb-2">
              For multi-chain analytics, SQL queries, and realtime APIs, use{" "}
              <a href="https://docs.allium.so/" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Allium</a>.
            </p>
            <a
              href="https://app.allium.so/join"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white transition-colors"
            >
              Get Allium access →
            </a>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-200 mb-3">Recent transactions</h2>
            <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-700 text-left text-zinc-500">
                      <th className="p-3 font-medium">Description</th>
                      <th className="p-3 font-medium">Signature</th>
                      <th className="p-3 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.transactions.map((tx) => (
                      <tr
                        key={tx.signature}
                        className="border-b border-zinc-800 hover:bg-zinc-800/50"
                      >
                        <td className="p-3 text-zinc-200 max-w-[280px]">
                          {tx.description ?? tx.type ?? "—"}
                        </td>
                        <td className="p-3 font-mono">
                          <a
                            href={`${SOLANA_EXPLORER}/tx/${tx.signature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-400 hover:underline"
                          >
                            {shortSignature(tx.signature)}
                          </a>
                        </td>
                        <td className="p-3 text-zinc-400">{formatDate(tx.blockTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {data.tokenAccounts.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-zinc-200 mb-3">
                Token accounts ({data.tokenAccounts.length})
              </h2>
              <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-700 text-left text-zinc-500">
                        <th className="p-3 font-medium">Symbol / Name</th>
                        <th className="p-3 font-medium">Mint</th>
                        <th className="p-3 font-medium">Amount</th>
                        <th className="p-3 font-medium">Frozen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.tokenAccounts.map((acc) => (
                        <tr
                          key={acc.address}
                          className="border-b border-zinc-800 hover:bg-zinc-800/50"
                        >
                          <td className="p-3 text-zinc-200">{acc.symbol ?? acc.name ?? "—"}</td>
                          <td className="p-3 font-mono text-zinc-400 text-xs break-all max-w-[180px] truncate" title={acc.mint}>
                            {shortSignature(acc.mint)}
                          </td>
                          <td className="p-3 text-zinc-300">
                            {acc.decimals != null
                              ? (acc.amount / 10 ** acc.decimals).toLocaleString(undefined, { maximumFractionDigits: 6 })
                              : acc.amount.toLocaleString()}
                          </td>
                          <td className="p-3 text-zinc-400">{acc.frozen ? "Yes" : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {data.nfts.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-zinc-200 mb-3">
                NFTs / digital assets ({data.nfts.length} shown)
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {data.nfts.map((nft) => (
                  <a
                    key={nft.id}
                    href={`${SOLANA_EXPLORER}/address/${nft.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-xl border border-zinc-700 bg-zinc-900/50 overflow-hidden hover:border-zinc-600 transition-colors"
                  >
                    <div className="aspect-square bg-zinc-800 flex items-center justify-center">
                      {nft.image ? (
                        <img
                          src={nft.image}
                          alt={nft.name ?? nft.id}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-zinc-500 text-xs">No image</span>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="text-zinc-200 text-sm font-medium truncate" title={nft.name ?? nft.id}>
                        {nft.name ?? shortSignature(nft.id)}
                      </p>
                      <p className="text-zinc-500 text-xs font-mono truncate" title={nft.id}>
                        {shortSignature(nft.id)}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}
        </section>
      )}

      {!data && !loading && !error && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/30 p-12 text-center text-zinc-500">
          Choose a lookup type (wallet, transaction, token, or NFT), enter an address/signature/ID (or a token ticker), and click &quot;Look up&quot;.
          <br />
          <span className="text-sm mt-2 block">
            Requires <code className="bg-zinc-800 px-1 rounded">HELIUS_API_KEY</code> in .env.local (
            <a href="https://dashboard.helius.dev" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">get a key</a>).
          </span>
          <p className="text-sm mt-4 text-zinc-500">
            Optional: add <a href="https://docs.allium.so/" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Allium</a> for multi-chain enrichment (
            <a href="https://app.allium.so/join" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">sign up</a>).
          </p>
        </div>
      )}

      <section className="mt-12 pt-8 border-t border-zinc-800" aria-label="Step 3: Generate and refine view">
        <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wide mb-1">Step 3 — AI dashboard</h2>
        <p className="text-lg font-semibold text-zinc-200 mb-1">Generate UGI dashboard</p>
        <p className="text-zinc-500 text-sm mb-4">
          Generate a custom dashboard from this lookup with AI. Then ask for a different view in plain language (e.g. &quot;Only SOL and top 5 tokens&quot;) to refine it.
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
            disabled={ugiStreaming || (!data && (lookupType !== "wallet" || !address.trim()))}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            aria-busy={ugiStreaming}
            aria-disabled={ugiStreaming || (!data && (lookupType !== "wallet" || !address.trim()))}
          >
            {ugiStreaming ? "Generating…" : "Generate UGI dashboard"}
          </button>
        </div>
        <div role="alert" aria-live="assertive" aria-atomic="true" className="min-h-[1.5rem]">
          {ugiError && <p className="text-red-400 text-sm mb-4">{ugiError}</p>}
        </div>

        {(data || ugiSpec) && (address.trim() || data) && (
          <div className="mb-4 p-4 rounded-xl border border-zinc-700 bg-zinc-900/30">
            <p className="text-zinc-300 text-sm font-medium mb-2">Ask for a different view</p>
            <p className="text-zinc-500 text-xs mb-3">Describe how you want the data broken down (e.g. focus on one metric, only tokens, or a list of recent activity).</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {["Only SOL and top 5 tokens", "Focus on NFTs only", "Transaction list with descriptions", "Just the key metrics"].map((label) => (
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
                placeholder="e.g. Show only my SOL balance and a list of tokens"
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
                        disabled={!data}
                        className="px-3 py-1.5 text-sm border border-zinc-600 hover:bg-zinc-800 text-zinc-300 rounded-lg disabled:opacity-50"
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
