"use client";

import { useState, useCallback, useRef } from "react";
import { createSpecStreamCompiler } from "@json-render/core";
import type { Spec } from "@json-render/core";
import type { AGUIEventType } from "./schema";

export interface AGUIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface AGUIState {
  messages: AGUIMessage[];
  mediaBundles: AGUIMediaBundle[];
  spec: Spec | null;
  toolCalls: Map<string, { name: string; args: string }>;
  state: Record<string, unknown>;
  isRunning: boolean;
}

export interface AGUIMediaBundle {
  id: string;
  query: string;
  tokenId: string;
  tokenSymbol?: string;
  tokenName?: string;
  token?: Record<string, unknown>;
  imageUrls: string[];
  ogImageUrl?: string;
  shareVideoEndpoint?: string;
  sameTickerCount?: number;
  suspiciousTickerCount?: number;
  trustScore?: number;
  trustGrade?: string;
  generatedAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeSpec(value: unknown): Spec | null {
  if (!isRecord(value)) return null;
  const root = typeof value.root === "string" ? value.root : "";
  const elements = isRecord(value.elements)
    ? (value.elements as Spec["elements"])
    : {};
  return { root, elements };
}

function parseMediaBundle(value: unknown): AGUIMediaBundle | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const query = asString(value.query);
  const tokenId = asString(value.tokenId);
  if (!id || !query || !tokenId) return null;

  const imageUrlsRaw = Array.isArray(value.imageUrls) ? value.imageUrls : [];
  const imageUrls = imageUrlsRaw
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry));

  return {
    id,
    query,
    tokenId,
    tokenSymbol: asString(value.tokenSymbol),
    tokenName: asString(value.tokenName),
    token: isRecord(value.token) ? value.token : undefined,
    imageUrls,
    ogImageUrl: asString(value.ogImageUrl),
    shareVideoEndpoint: asString(value.shareVideoEndpoint),
    sameTickerCount: asNumber(value.sameTickerCount),
    suspiciousTickerCount: asNumber(value.suspiciousTickerCount),
    trustScore: asNumber(value.trustScore),
    trustGrade: asString(value.trustGrade),
    generatedAt: asString(value.generatedAt),
  };
}

export function useAGUI() {
  const compilerRef = useRef<ReturnType<typeof createSpecStreamCompiler> | null>(null);
  const [aguiState, setAGUIState] = useState<AGUIState>({
    messages: [],
    mediaBundles: [],
    spec: null,
    toolCalls: new Map(),
    state: {},
    isRunning: false,
  });

  const processEvent = useCallback((event: AGUIEventType) => {
    setAGUIState((prev) => {
      const next = { ...prev };
      switch (event.type) {
        case "RUN_STARTED":
          compilerRef.current = createSpecStreamCompiler({
            root: "",
            elements: {},
          });
          next.spec = { root: "", elements: {} };
          next.isRunning = true;
          break;
        case "RUN_FINISHED":
          next.isRunning = false;
          break;
        case "TEXT_MESSAGE_START":
          next.messages = [
            ...prev.messages,
            { id: event.messageId, role: event.role, content: "" },
          ];
          break;
        case "TEXT_MESSAGE_CONTENT":
          next.messages = prev.messages.map((msg) =>
            msg.id === event.messageId
              ? { ...msg, content: msg.content + event.delta }
              : msg
          );
          if (!compilerRef.current) {
            compilerRef.current = createSpecStreamCompiler({
              root: "",
              elements: {},
            });
          }
          const out = compilerRef.current.push(event.delta);
          if (out.newPatches.length > 0 && out.result) {
            const spec = normalizeSpec(out.result);
            if (spec) next.spec = spec;
          }
          break;
        case "TEXT_MESSAGE_END":
          if (compilerRef.current) {
            const final = normalizeSpec(compilerRef.current.getResult());
            if (
              final &&
              (final.root.length > 0 ||
                Object.keys(final.elements).length > 0)
            ) {
              next.spec = final;
            }
          }
          break;
        case "TOOL_CALL_START":
          next.toolCalls = new Map(prev.toolCalls);
          next.toolCalls.set(event.toolCallId, {
            name: event.toolCallName,
            args: "",
          });
          break;
        case "TOOL_CALL_ARGS":
          next.toolCalls = new Map(prev.toolCalls);
          const tc = next.toolCalls.get(event.toolCallId);
          if (tc) {
            next.toolCalls.set(event.toolCallId, {
              ...tc,
              args: tc.args + event.delta,
            });
          }
          break;
        case "STATE_SNAPSHOT":
          next.state = event.snapshot;
          break;
        case "CUSTOM":
          if (event.name === "media_bundle") {
            const bundle = parseMediaBundle(event.value);
            if (bundle) {
              next.mediaBundles = [
                bundle,
                ...prev.mediaBundles.filter((item) => item.id !== bundle.id),
              ].slice(0, 6);
            }
          }
          break;
        default:
          break;
      }
      return next;
    });
  }, []);

  return { state: aguiState, processEvent };
}
