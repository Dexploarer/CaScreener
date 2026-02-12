"use client";

import { useState, useCallback, useEffect, useRef, type ChangeEvent } from "react";
import { useSearchParams } from "next/navigation";
import { createSpecStreamCompiler } from "@json-render/core";
import { specToReactLikeCode } from "@/lib/code-export";
import type {
  LookupType,
  LookupResult,
  WalletAnalytics,
  UgiSpecShape,
  UgiSpecFlat,
  UgiElementLike,
} from "./types";
import { SOLANA_EXPLORER } from "./utils";

const DASHBOARD_STORAGE_PREFIX = "helius:dashboard:";

function getLookupId(data: LookupResult | null): string | null {
  if (!data) return null;
  if (data.resultType === "wallet") return data.address;
  if (data.resultType === "transaction") return data.signature;
  return "id" in data ? data.id : null;
}

function getDashboardStorageKey(type: LookupType, id: string): string {
  return `${DASHBOARD_STORAGE_PREFIX}${type}:${id}`;
}

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

export type HeliusDashboardState = {
  lookupType: LookupType;
  setLookupType: (value: LookupType) => void;
  address: string;
  setAddress: (value: string) => void;
  loading: boolean;
  error: string | null;
  data: LookupResult | null;
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  loadDashboard: (addr: string) => void;
  loadLookup: (type: LookupType, id: string) => void;
  ugiSpec: UgiSpecShape | null;
  ugiStreaming: boolean;
  ugiError: string | null;
  ugiProvider: "openai" | "anthropic";
  onUgiProviderChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  copyFeedback: "spec" | "summary" | "code" | "link" | "saved" | "restored" | null;
  followUpPrompt: string;
  setFollowUpPrompt: (value: string) => void;
  generateUgiDashboard: () => void;
  copySpecJson: () => void;
  copySummary: () => void;
  copyExportCode: () => void;
  requestViewUpdate: (promptText: string) => void;
  getActionHandlers: () => { submit: () => void; navigate: (params: unknown) => void; copy: (params: unknown) => Promise<void> };
  saveDashboard: () => void;
  restoreSavedDashboard: () => void;
  copyDashboardLink: () => void;
  canRestoreSaved: boolean;
};

export function useHeliusDashboard(): HeliusDashboardState {
  const [lookupType, setLookupTypeState] = useState<LookupType>("wallet");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LookupResult | null>(null);
  const [ugiSpec, setUgiSpec] = useState<UgiSpecShape | null>(null);
  const [ugiStreaming, setUgiStreaming] = useState(false);
  const [ugiError, setUgiError] = useState<string | null>(null);
  const [ugiProvider, setUgiProvider] = useState<"openai" | "anthropic">("openai");
  const [copyFeedback, setCopyFeedback] = useState<"spec" | "summary" | "code" | "link" | "saved" | "restored" | null>(null);
  const [followUpPrompt, setFollowUpPrompt] = useState("");
  const compilerRef = useRef<ReturnType<typeof createSpecStreamCompiler> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
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
    if (typeof window === "undefined" || !ugiSpec?.root) return;
    const encoded = specToHash(ugiSpec);
    if (!encoded) return;
    const newHash = `#spec=${encoded}`;
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
    }
  }, [ugiSpec]);

  const setLookupType = useCallback((value: LookupType) => {
    setLookupTypeState(value);
    setData(null);
    setError(null);
  }, []);

  useEffect(() => {
    const q = searchParams.get("address")?.trim();
    const t = searchParams.get("type") as LookupType | null;
    if (q) setAddress((prev) => prev || q);
    if (t && ["wallet", "transaction", "token", "nft"].includes(t)) setLookupTypeState(t);
  }, [searchParams]);

  useEffect(() => {
    const trimmed = address.trim();
    if (!trimmed || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("address", trimmed);
    url.searchParams.set("type", lookupType);
    if (url.search !== window.location.search) {
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, [address, lookupType]);

  const loadLookup = useCallback(async (type: LookupType, id: string) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    setError(null);
    setData(null);
    setLoading(true);
    try {
      const res = await fetch("/api/helius/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.details ?? json.error ?? "Request failed");
        return;
      }
      setData(json as LookupResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDashboard = useCallback(
    (addr: string) => loadLookup(lookupType, addr),
    [lookupType, loadLookup]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      loadLookup(lookupType, address);
    },
    [lookupType, address, loadLookup]
  );

  const generateUgiDashboard = useCallback(async () => {
    const trimmed = address.trim();
    if (!trimmed && !data) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    compilerRef.current = createSpecStreamCompiler({ root: "", elements: {} });
    setUgiSpec({ root: "", elements: {} });
    setUgiStreaming(true);
    setUgiError(null);
    const payload: {
      provider: string;
      address?: string;
      analytics?: {
        address: string;
        solBalance: number;
        transactionCount: number;
        tokenCount: number;
        nftCount: number;
      };
      lookupResult?: LookupResult;
    } = { provider: ugiProvider };
    if (data) {
      payload.lookupResult = data;
    } else if (lookupType === "wallet" && trimmed) {
      payload.address = trimmed;
    }
    try {
      const res = await fetch("/api/helius/generate-dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: abortRef.current.signal,
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
  }, [address, lookupType, ugiProvider, data]);

  const copySpecJson = useCallback(() => {
    if (!ugiSpec?.root) return;
    navigator.clipboard.writeText(JSON.stringify(ugiSpec, null, 2)).then(() => {
      setCopyFeedback("spec");
      setTimeout(() => setCopyFeedback(null), 2000);
    });
  }, [ugiSpec]);

  const copySummary = useCallback(() => {
    const lines: string[] = [];
    if (data?.resultType === "wallet") {
      lines.push("Helius Wallet Summary", `Address: ${data.address}`, `SOL: ${data.solBalance.toFixed(4)}`, `Transactions: ${data.transactionCount}`, `Token accounts: ${data.tokenCount}`, `NFTs: ${data.nftCount}`);
    } else if (data?.resultType === "transaction") {
      lines.push("Transaction", `Signature: ${data.signature}`, `Slot: ${data.slot}`, `Fee: ${data.fee ?? "—"}`, `Fee payer: ${data.feePayer ?? "—"}`);
    } else if (data?.resultType === "token") {
      lines.push("Token", `ID: ${data.id}`, `Name: ${data.name ?? "—"}`, `Symbol: ${data.symbol ?? "—"}`, `Decimals: ${data.decimals ?? "—"}`);
      lines.push(`Lookup mode: ${data.lookupMode ?? "mint"}`);
      lines.push(`Ticker scan: ${data.searchedTicker ?? data.symbol ?? "—"}`);
      lines.push(`Same-ticker matches: ${data.sameTickerCount ?? data.sameTickerTokens?.length ?? 0}`);
      lines.push(`Medium/High risk matches: ${data.suspiciousTickerCount ?? 0}`);
      lines.push(`Image sources: ${data.imageUris?.length ?? (data.imageUri ? 1 : 0)}`);
      lines.push(`Same-ticker image sources: ${data.sameTickerImageCount ?? 0}`);
      if (data.sameTickerTokens?.length) {
        lines.push("Top same-ticker tokens:");
        data.sameTickerTokens.slice(0, 12).forEach((t) => {
          lines.push(`- ${t.symbol}${t.name ? ` (${t.name})` : ""} | ${t.mint} | risk=${t.risk} | liq=${t.liquidityUsd ?? "—"} | vol24=${t.volume24hUsd ?? "—"} | imgs=${t.imageUris?.length ?? (t.imageUri ? 1 : 0)}`);
        });
      }
    } else if (data?.resultType === "nft") {
      lines.push("NFT", `ID: ${data.id}`, `Name: ${data.name ?? "—"}`, `Symbol: ${data.symbol ?? "—"}`);
    } else {
      lines.push("Helius Lookup", `Type: ${lookupType}`, `ID: ${address.trim() || "—"}`);
    }
    if (ugiSpec?.root) lines.push("(UGI dashboard generated)");
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopyFeedback("summary");
      setTimeout(() => setCopyFeedback(null), 2000);
    });
  }, [address, lookupType, data, ugiSpec]);

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

  const requestViewUpdate = useCallback(async (promptText: string) => {
    const promptTrimmed = promptText.trim();
    if (!promptTrimmed || !data) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    compilerRef.current = createSpecStreamCompiler({ root: "", elements: {} });
    setUgiSpec((prev) => (prev ? { root: "", elements: {} } : null));
    setUgiStreaming(true);
    setUgiError(null);
    const payload = {
      provider: ugiProvider,
      followUpPrompt: promptTrimmed,
      lookupResult: data,
      ...(ugiSpec?.root ? { currentSpec: ugiSpec } : {}),
    };
    try {
      const res = await fetch("/api/helius/generate-dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: abortRef.current.signal,
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
  }, [ugiProvider, data, ugiSpec]);

  const onUgiProviderChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setUgiProvider(e.target.value as "openai" | "anthropic");
  }, []);

  const getActionHandlers = useCallback(
    () => ({
      submit: () => {},
      navigate: (params: unknown) => {
        const p = params as { url?: string };
        let defaultUrl: string | undefined;
        if (data?.resultType === "transaction") defaultUrl = `${SOLANA_EXPLORER}/tx/${data.signature}`;
        else if (data?.resultType === "wallet") defaultUrl = `${SOLANA_EXPLORER}/address/${data.address}`;
        else if (data && ("id" in data)) defaultUrl = `${SOLANA_EXPLORER}/address/${data.id}`;
        else if (address.trim()) defaultUrl = `${SOLANA_EXPLORER}/address/${address.trim()}`;
        const url = p?.url ?? defaultUrl;
        if (url) window.open(url, "_blank", "noopener,noreferrer");
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
    [address, data]
  );

  const saveDashboard = useCallback(() => {
    if (typeof window === "undefined" || !ugiSpec?.root || !data) return;
    const id = getLookupId(data);
    if (!id) return;
    const key = getDashboardStorageKey(lookupType, id);
    try {
      localStorage.setItem(key, JSON.stringify(ugiSpec));
      setCopyFeedback("saved");
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setCopyFeedback(null);
    }
  }, [lookupType, data, ugiSpec]);

  const restoreSavedDashboard = useCallback(() => {
    if (typeof window === "undefined" || !data) return;
    const id = getLookupId(data);
    if (!id) return;
    const key = getDashboardStorageKey(lookupType, id);
    try {
      const raw = localStorage.getItem(key);
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
  }, [lookupType, data]);

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
    !!data &&
    (() => {
      const id = getLookupId(data);
      if (!id) return false;
      try {
        return localStorage.getItem(getDashboardStorageKey(lookupType, id)) != null;
      } catch {
        return false;
      }
    })();

  return {
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
  };
}
