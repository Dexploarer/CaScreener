"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

export interface ViralCardNavLink {
  label: string;
  prompt: string;
}

export interface ViralCardNavItem {
  label: string;
  summary: string;
  background: string;
  textColor?: string;
  links: ViralCardNavLink[];
}

interface ViralCardNavProps {
  items: ViralCardNavItem[];
  onSelectPrompt: (prompt: string) => void;
}

const COLLAPSED_HEIGHT = 68;

export function ViralCardNav({ items, onSelectPrompt }: ViralCardNavProps) {
  const [expanded, setExpanded] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const cardsRef = useRef<Array<HTMLDivElement | null>>([]);
  const timelineRef = useRef<any>(null);
  const gsapRef = useRef<any>(null);
  const visibleItems = useMemo(() => items.slice(0, 3), [items]);

  const calculateExpandedHeight = () => {
    const contentEl = contentRef.current;
    if (!contentEl) return 300;
    return COLLAPSED_HEIGHT + contentEl.scrollHeight + 12;
  };

  useLayoutEffect(() => {
    const navEl = navRef.current;
    if (!navEl) return;

    let cancelled = false;
    void (async () => {
      try {
        const mod = await import("gsap");
        const gsap = (mod as any).gsap ?? (mod as any).default;
        if (!gsap) return;
        if (cancelled) return;
        gsapRef.current = gsap;

        const cards = cardsRef.current.filter(
          (card): card is HTMLDivElement => card !== null
        );
        gsap.set(navEl, { height: COLLAPSED_HEIGHT, overflow: "hidden" });
        gsap.set(cards, { y: 24, opacity: 0 });

        const timeline = gsap.timeline({ paused: true });
        timeline.to(navEl, {
          height: calculateExpandedHeight,
          duration: 0.45,
          ease: "power3.out",
        });
        timeline.to(
          cards,
          {
            y: 0,
            opacity: 1,
            duration: 0.35,
            ease: "power2.out",
            stagger: 0.07,
          },
          "-=0.16"
        );

        timelineRef.current = timeline;
      } catch {
        // Keep nav functional without animation if GSAP fails to load.
      }
    })();

    return () => {
      cancelled = true;
      const timeline = timelineRef.current;
      if (!timeline) return;
      timeline.kill();
      timelineRef.current = null;
    };
  }, [visibleItems]);

  useLayoutEffect(() => {
    const handleResize = () => {
      const gsap = gsapRef.current;
      if (!expanded || !navRef.current || !gsap) return;
      gsap.set(navRef.current, { height: calculateExpandedHeight() });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [expanded]);

  const toggleMenu = () => {
    const timeline = timelineRef.current;
    if (!timeline) {
      setExpanded((prev) => !prev);
      return;
    }

    if (!expanded) {
      setExpanded(true);
      timeline.play(0);
      return;
    }

    timeline.eventCallback("onReverseComplete", () => {
      setExpanded(false);
      timeline.eventCallback("onReverseComplete", null);
    });
    timeline.reverse();
  };

  const setCardRef = (index: number) => (element: HTMLDivElement | null) => {
    cardsRef.current[index] = element;
  };

  const handlePromptSelect = (prompt: string) => {
    onSelectPrompt(prompt);
    if (expanded) {
      toggleMenu();
    }
  };

  return (
    <nav
      ref={navRef}
      className="rounded-2xl border border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl shadow-[0_30px_80px_-45px_rgba(6,182,212,0.6)]"
      aria-label="Generation lanes"
    >
      <div className="h-[68px] px-3 sm:px-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={toggleMenu}
          aria-label={expanded ? "Close lane menu" : "Open lane menu"}
          className="group inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/70 text-zinc-300 transition hover:border-zinc-700 hover:text-zinc-100"
        >
          <span className="relative block h-3 w-5">
            <span
              className={`absolute left-0 top-0 block h-[2px] w-5 bg-current transition-transform duration-200 ${
                expanded ? "translate-y-[5px] rotate-45" : ""
              }`}
            />
            <span
              className={`absolute left-0 top-[8px] block h-[2px] w-5 bg-current transition-transform duration-200 ${
                expanded ? "-translate-y-[3px] -rotate-45" : ""
              }`}
            />
          </span>
        </button>

        <div className="min-w-0 text-center">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            Meme Intel Engine
          </p>
          <p className="text-sm sm:text-base font-semibold text-zinc-100 truncate">
            Signal-first dashboards with one-click virality
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            onSelectPrompt(
              "Show me the highest-conviction meme coin opportunities right now with trust scoring and clone risk."
            )
          }
          className="hidden sm:inline-flex items-center rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:border-emerald-400/70 hover:bg-emerald-500/25"
        >
          Quick alpha scan
        </button>
      </div>

      <div
        ref={contentRef}
        className="grid grid-cols-1 gap-2 px-3 pb-3 sm:grid-cols-3"
        style={{
          visibility: expanded ? "visible" : "hidden",
          pointerEvents: expanded ? "auto" : "none",
        }}
      >
        {visibleItems.map((item, index) => (
          <div
            key={item.label}
            ref={setCardRef(index)}
            className="rounded-xl border border-zinc-800/80 p-3 sm:p-4 min-h-[170px] flex flex-col"
            style={{
              background: item.background,
              color: item.textColor ?? "#e4e4e7",
            }}
          >
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold tracking-tight">{item.label}</h3>
              <p className="text-xs leading-relaxed opacity-80">{item.summary}</p>
            </div>

            <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
              {item.links.slice(0, 3).map((link) => (
                <button
                  key={`${item.label}-${link.label}`}
                  type="button"
                  onClick={() => handlePromptSelect(link.prompt)}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-black/20 px-2.5 py-1.5 text-xs font-medium transition hover:border-white/30 hover:bg-black/30"
                >
                  {link.label}
                  <ArrowUpRightIcon />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17L17 7" />
      <path d="M7 7h10v10" />
    </svg>
  );
}
