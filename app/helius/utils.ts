import type { Spec } from "@json-render/react";
import type { UgiSpecShape, ValidatorMap } from "./types";

export const SOLANA_EXPLORER = "https://explorer.solana.com";

export function formatDate(ts: number | null): string {
  if (ts == null) return "—";
  return new Date(ts * 1000).toLocaleString();
}

export function formatUsdCompact(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatDateFromMs(ts: number | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return "—";
  return new Date(ts).toLocaleDateString();
}

export function toDisplayMediaUrl(uri: string): string {
  const raw = uri.trim();
  if (raw.toLowerCase().startsWith("ipfs://")) {
    const path = raw.slice("ipfs://".length).replace(/^ipfs\//i, "");
    return `https://ipfs.io/ipfs/${path}`;
  }
  return raw;
}

export function shortSignature(sig: string): string {
  if (sig.length <= 16) return sig;
  return `${sig.slice(0, 8)}…${sig.slice(-8)}`;
}

export function toSpec(s: UgiSpecShape): Spec {
  return s as Spec;
}

export const initialData = { user: { name: "Guest" }, form: {} };

export const validators: ValidatorMap = {
  required: (v) => v != null && String(v).trim() !== "",
};
