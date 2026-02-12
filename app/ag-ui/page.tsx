"use client";

import { useRef, useState } from "react";
import { Renderer } from "@json-render/react";
import { useAGUI, type AGUIMediaBundle } from "@/lib/integrations/ag-ui/use-agui";
import { AGUIEvent } from "@/lib/integrations/ag-ui/schema";
import { registry } from "@/lib/registry";

export default function AGUIPage() {
  const { state, processEvent } = useAGUI();
  const inputRef = useRef<HTMLInputElement>(null);
  const [videoByBundle, setVideoByBundle] = useState<
    Record<string, { loading: boolean; previewUrl?: string; downloadUrl?: string; error?: string }>
  >({});

  async function startRun(prompt: string) {
    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const event = JSON.parse(trimmed) as unknown;
        const parsed = AGUIEvent.safeParse(event);
        if (parsed.success) processEvent(parsed.data);
      } catch {
        // skip invalid lines
      }
    };

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        throw new Error(`Agent request failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          processLine(line);
        }
      }

      buffer += decoder.decode();
      processLine(buffer);
    } catch (error) {
      console.error("AG-UI stream error:", error);
    }
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = inputRef.current?.value?.trim();
    if (value) {
      startRun(value);
      inputRef.current!.value = "";
    }
  };

  const renderHypeVideo = async (bundle: AGUIMediaBundle) => {
    if (!bundle.token || !bundle.shareVideoEndpoint) {
      setVideoByBundle((prev) => ({
        ...prev,
        [bundle.id]: { loading: false, error: "Missing token payload for video render." },
      }));
      return;
    }

    setVideoByBundle((prev) => ({
      ...prev,
      [bundle.id]: { loading: true },
    }));

    try {
      const res = await fetch(bundle.shareVideoEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: bundle.token }),
      });
      const json = (await res.json()) as {
        error?: string;
        previewUrl?: string;
        downloadUrl?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || `Video render failed (${res.status})`);
      }
      setVideoByBundle((prev) => ({
        ...prev,
        [bundle.id]: {
          loading: false,
          previewUrl: json.previewUrl,
          downloadUrl: json.downloadUrl,
        },
      }));
    } catch (error) {
      setVideoByBundle((prev) => ({
        ...prev,
        [bundle.id]: {
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  };

  return (
    <main className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-zinc-100 mb-2">AG-UI Integration</h1>
      <p className="text-zinc-400 mb-6">
        CopilotKit&apos;s Agent User Interaction Protocol: events for streaming
        text, tool calls, and state.
      </p>

      <div className="max-w-xl space-y-4">
        {state.mediaBundles.length > 0 && (
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/30 p-4 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Media Packs
            </h2>
            {state.mediaBundles.map((bundle) => {
              const video = videoByBundle[bundle.id];
              return (
                <div key={bundle.id} className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
                    <span className="font-semibold text-zinc-100">
                      {bundle.tokenSymbol || bundle.tokenId}
                    </span>
                    <span>Query: {bundle.query}</span>
                    {typeof bundle.trustScore === "number" && (
                      <span>
                        Trust: {bundle.trustScore}/100 {bundle.trustGrade ? `(${bundle.trustGrade})` : ""}
                      </span>
                    )}
                    {typeof bundle.sameTickerCount === "number" && (
                      <span>Same ticker: {bundle.sameTickerCount}</span>
                    )}
                    {typeof bundle.suspiciousTickerCount === "number" && (
                      <span>Suspicious: {bundle.suspiciousTickerCount}</span>
                    )}
                  </div>

                  {bundle.imageUrls.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2">
                      {bundle.imageUrls.slice(0, 9).map((url, idx) => (
                        <img
                          key={`${bundle.id}:${idx}`}
                          src={url}
                          alt={`${bundle.tokenSymbol || "token"} image ${idx + 1}`}
                          className="h-20 w-full rounded-md border border-zinc-700 object-cover bg-zinc-950"
                          loading="lazy"
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500">No token images were discovered for this query.</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {bundle.ogImageUrl && (
                      <a
                        href={bundle.ogImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 text-xs rounded-md bg-cyan-700/60 hover:bg-cyan-600/70 text-white"
                      >
                        Open OG Image
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => renderHypeVideo(bundle)}
                      disabled={video?.loading}
                      className="px-3 py-1.5 text-xs rounded-md bg-emerald-700/60 hover:bg-emerald-600/70 text-white disabled:opacity-50"
                    >
                      {video?.loading ? "Rendering Video..." : "Render Hype Video"}
                    </button>
                    {video?.downloadUrl && (
                      <a
                        href={video.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 text-xs rounded-md bg-violet-700/60 hover:bg-violet-600/70 text-white"
                      >
                        Download Video
                      </a>
                    )}
                  </div>

                  {video?.previewUrl && (
                    <video
                      src={video.previewUrl}
                      controls
                      className="w-full rounded-md border border-zinc-700 bg-black"
                    />
                  )}
                  {video?.error && <p className="text-xs text-red-300">{video.error}</p>}
                </div>
              );
            })}
          </div>
        )}

        {state.spec?.root && (
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/30 p-4 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Live JSON-to-UI Render
            </h2>
            <Renderer
              spec={state.spec}
              registry={registry}
              loading={state.isRunning}
            />
          </div>
        )}

        <div className="rounded-xl border border-zinc-700 bg-zinc-900/30 p-4 space-y-3 max-h-96 overflow-y-auto">
          {state.messages.map((msg) => (
            <div
              key={msg.id}
              className={`p-3 rounded-lg ${
                msg.role === "assistant"
                  ? "bg-zinc-800 text-zinc-200"
                  : "bg-emerald-900/30 text-zinc-100"
              }`}
            >
              <span className="text-xs text-zinc-500 uppercase">{msg.role}</span>
              <p className="mt-1 whitespace-pre-wrap">{msg.content || "…"}</p>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            placeholder="Ask the agent..."
            className="flex-1 border border-zinc-600 rounded-lg bg-zinc-900 px-4 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            disabled={state.isRunning}
          />
          <button
            type="submit"
            disabled={state.isRunning}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg disabled:opacity-50"
          >
            {state.isRunning ? "Running…" : "Send"}
          </button>
        </form>
      </div>
    </main>
  );
}
