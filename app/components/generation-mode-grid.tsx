"use client";

import { useLayoutEffect, useRef } from "react";

export interface GenerationMode {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  prompt: string;
  stats: string[];
  accent: string;
  gradient: string;
}

interface GenerationModeGridProps {
  modes: GenerationMode[];
  onSelectPrompt: (prompt: string) => void;
}

export function GenerationModeGrid({
  modes,
  onSelectPrompt,
}: GenerationModeGridProps) {
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useLayoutEffect(() => {
    let animation: { kill: () => void } | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const { gsap } = await import("gsap");
        if (cancelled) return;
        const cards = cardRefs.current.filter(
          (card): card is HTMLButtonElement => card !== null
        );
        if (!cards.length) return;
        animation = gsap.fromTo(
          cards,
          { opacity: 0, y: 20 },
          {
            opacity: 1,
            y: 0,
            duration: 0.42,
            stagger: 0.06,
            ease: "power2.out",
          }
        );
      } catch {
        // Keep cards usable without GSAP animation.
      }
    })();

    return () => {
      cancelled = true;
      animation?.kill();
    };
  }, [modes]);

  const setCardRef = (index: number) => (element: HTMLButtonElement | null) => {
    cardRefs.current[index] = element;
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {modes.map((mode, index) => (
        <button
          key={mode.id}
          ref={setCardRef(index)}
          type="button"
          onClick={() => onSelectPrompt(mode.prompt)}
          className="group relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/70 p-4 text-left transition hover:-translate-y-0.5 hover:border-zinc-700 hover:bg-zinc-900"
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-30 transition group-hover:opacity-45"
            style={{ backgroundImage: mode.gradient }}
          />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.12),transparent_45%)] opacity-0 transition group-hover:opacity-100" />

          <div className="relative">
            <span
              className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em]"
              style={{ borderColor: mode.accent, color: mode.accent }}
            >
              {mode.subtitle}
            </span>

            <h3 className="mt-3 text-lg font-semibold tracking-tight text-zinc-50">
              {mode.title}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">
              {mode.description}
            </p>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {mode.stats.map((stat) => (
                <span
                  key={`${mode.id}-${stat}`}
                  className="rounded-md border border-zinc-700/80 bg-black/25 px-2 py-1 text-[11px] font-medium text-zinc-300"
                >
                  {stat}
                </span>
              ))}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
