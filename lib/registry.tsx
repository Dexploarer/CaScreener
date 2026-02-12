"use client";

import { useRef, useEffect } from "react";
import Script from "next/script";
import { defineRegistry, useActions, useStateBinding } from "@json-render/react";
import { catalog } from "./catalog";

const BADGE_VARIANTS: Record<string, string> = {
  default: "border-zinc-700 text-zinc-400 bg-zinc-800/50",
  success: "border-emerald-500/30 text-emerald-400 bg-emerald-500/10",
  warning: "border-amber-500/30 text-amber-400 bg-amber-500/10",
  danger: "border-red-500/30 text-red-400 bg-red-500/10",
  info: "border-cyan-500/30 text-cyan-400 bg-cyan-500/10",
};

const BAR_COLORS: Record<string, string> = {
  emerald: "bg-emerald-500",
  cyan: "bg-cyan-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  violet: "bg-violet-500",
};

const STROKE_COLORS: Record<string, string> = {
  emerald: "#10b981",
  cyan: "#06b6d4",
  amber: "#f59e0b",
  red: "#ef4444",
  violet: "#8b5cf6",
};

const FILL_COLORS: Record<string, string> = {
  emerald: "#10b981",
  cyan: "#06b6d4",
  amber: "#f59e0b",
  red: "#ef4444",
  violet: "#8b5cf6",
  zinc: "#71717a",
};

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

function shortUrl(value: string, max = 40): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

export const { registry } = defineRegistry(catalog, {
  components: {
    Card: ({ props, children }) => (
      <div className="p-5 border border-zinc-800/60 rounded-2xl bg-zinc-900/30 backdrop-blur-sm">
        <div className="mb-1">
          <h2 className="font-semibold text-base text-zinc-100 truncate">
            {props.title}
          </h2>
        </div>
        {props.description && (
          <p className="text-zinc-600 text-xs uppercase tracking-wider mb-4 truncate">
            {props.description}
          </p>
        )}
        <div>{children}</div>
      </div>
    ),

    Button: ({ props, emit }) => {
      const { execute } = useActions();

      const onClick = () => {
        if (props.action) {
          void execute({
            action: props.action,
            params: props.params ?? {},
          });
          return;
        }
        emit?.("press");
      };

      return (
        <button
          type="button"
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600/90 hover:bg-emerald-500 text-white rounded-xl font-medium transition-colors text-sm"
          onClick={onClick}
        >
          {props.label}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="opacity-60"
          >
            <path d="M7 17l9.2-9.2M17 17V7H7" />
          </svg>
        </button>
      );
    },

    Text: ({ props }) => (
      <p className="text-zinc-400 leading-relaxed text-sm">{props.content}</p>
    ),

    Heading: ({ props }) => {
      const sizes = {
        sm: "text-xs font-semibold uppercase tracking-wider text-zinc-500",
        md: "text-sm font-semibold text-zinc-300",
        lg: "text-base font-bold text-zinc-200",
      };
      const cls = sizes[props.size ?? "md"] ?? sizes.md;
      return <h3 className={cls}>{props.text}</h3>;
    },

    Stack: ({ props, children }) => (
      <div
        className="flex min-w-0"
        style={{
          flexDirection:
            props.direction === "horizontal" ? "row" : "column",
          flexWrap: props.direction === "horizontal" ? "wrap" : undefined,
          gap:
            props.gap === "sm"
              ? "0.5rem"
              : props.gap === "lg"
                ? "1.5rem"
                : "0.75rem",
        }}
      >
        {children}
      </div>
    ),

    Metric: ({ props }) => {
      const isPositive =
        typeof props.value === "string" && props.value.startsWith("+");
      const isNegative =
        typeof props.value === "string" && props.value.startsWith("-");
      const changePositive =
        typeof props.change === "string" && props.change.startsWith("+");
      const changeNegative =
        typeof props.change === "string" && props.change.startsWith("-");

      return (
        <div className="flex-1 min-w-[110px] p-3.5 rounded-xl bg-zinc-800/40 border border-zinc-800/60 overflow-hidden">
          <span className="text-zinc-500 text-[10px] font-semibold uppercase tracking-wider block mb-1 truncate">
            {props.label}
          </span>
          <span
            className={`text-lg font-semibold tabular-nums block truncate ${isPositive
              ? "text-emerald-400"
              : isNegative
                ? "text-red-400"
                : "text-zinc-100"
              }`}
          >
            {props.value}
          </span>
          {props.change && (
            <span
              className={`text-xs font-medium tabular-nums mt-0.5 block truncate ${changePositive
                ? "text-emerald-400/80"
                : changeNegative
                  ? "text-red-400/80"
                  : "text-zinc-500"
                }`}
            >
              {props.change}
            </span>
          )}
        </div>
      );
    },

    Badge: ({ props }) => {
      const variant = BADGE_VARIANTS[props.variant ?? "default"] ?? BADGE_VARIANTS.default;
      return (
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${variant}`}
        >
          {props.label}
        </span>
      );
    },

    Divider: ({ props }) =>
      props.label ? (
        <div className="flex items-center gap-3 my-1">
          <div className="flex-1 h-px bg-zinc-800" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
            {props.label}
          </span>
          <div className="flex-1 h-px bg-zinc-800" />
        </div>
      ) : (
        <div className="h-px bg-zinc-800 my-1" />
      ),

    Table: ({ props }) => (
      <div className="overflow-x-auto rounded-xl border border-zinc-800/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800/60">
              {props.columns.map((col: string, i: number) => (
                <th
                  key={i}
                  className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-zinc-800/30"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row: string[], ri: number) => (
              <tr
                key={ri}
                className="border-b border-zinc-800/30 last:border-0 hover:bg-zinc-800/20 transition-colors"
              >
                {row.map((cell: string, ci: number) => {
                  const isPos = cell.startsWith("+");
                  const isNeg = cell.startsWith("-");
                  const isLink = isHttpUrl(cell);
                  return (
                    <td
                      key={ci}
                      className={`px-3 py-2 tabular-nums truncate max-w-[200px] ${isPos
                        ? "text-emerald-400"
                        : isNeg
                          ? "text-red-400"
                          : ci === 0
                            ? "text-zinc-200 font-medium"
                            : "text-zinc-400"
                        }`}
                    >
                      {isLink ? (
                        <a
                          href={cell}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
                          title={cell}
                        >
                          {shortUrl(cell)}
                        </a>
                      ) : (
                        cell
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),

    ProgressBar: ({ props }) => {
      const max = props.max ?? 100;
      const pct = Math.min(100, Math.max(0, (props.value / max) * 100));
      const color = BAR_COLORS[props.color ?? "emerald"] ?? BAR_COLORS.emerald;

      return (
        <div className="space-y-1">
          <div className="flex justify-between items-baseline">
            <span className="text-xs text-zinc-400 truncate">{props.label}</span>
            <span className="text-xs font-medium tabular-nums text-zinc-300 ml-2">
              {props.value}
              {max === 100 ? "%" : `/${max}`}
            </span>
          </div>
          <div className="h-2 rounded-full bg-zinc-800/60 overflow-hidden">
            <div
              className={`h-full rounded-full ${color} transition-all duration-500`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      );
    },

    SparkLine: ({ props }) => {
      const data = props.data ?? [];
      if (data.length < 2) return null;
      const h = props.height ?? 48;
      const w = 240;
      const pad = 2;
      const min = Math.min(...data);
      const max = Math.max(...data);
      const range = max - min || 1;

      const points = data
        .map((v: number, i: number) => {
          const x = (i / (data.length - 1)) * (w - pad * 2) + pad;
          const y = h - pad - ((v - min) / range) * (h - pad * 2);
          return `${x},${y}`;
        })
        .join(" ");

      const isUp = data[data.length - 1] >= data[0];
      const strokeColor =
        STROKE_COLORS[props.color ?? ""] ?? (isUp ? "#10b981" : "#ef4444");

      // Gradient fill under the line
      const gradientId = `spark-grad-${Math.random().toString(36).slice(2, 8)}`;
      const areaPoints = `${pad},${h - pad} ${points} ${w - pad},${h - pad}`;

      return (
        <div className="w-full rounded-lg overflow-hidden bg-zinc-800/20 border border-zinc-800/40 p-2">
          <svg
            viewBox={`0 0 ${w} ${h}`}
            className="w-full"
            style={{ height: h }}
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity="0.3" />
                <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon
              points={areaPoints}
              fill={`url(#${gradientId})`}
            />
            <polyline
              points={points}
              fill="none"
              stroke={strokeColor}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        </div>
      );
    },

    BarChart: ({ props }) => {
      const bars = props.bars ?? [];
      if (bars.length === 0) return null;
      const maxVal = Math.max(...bars.map((b: { value: number }) => b.value), 1);

      return (
        <div className="space-y-2.5 p-3 rounded-xl bg-zinc-800/20 border border-zinc-800/40">
          {bars.map((bar: { label: string; value: number; color: string | null }, i: number) => {
            const pct = Math.min(100, (bar.value / maxVal) * 100);
            const color =
              BAR_COLORS[bar.color ?? "emerald"] ?? BAR_COLORS.emerald;
            return (
              <div key={i} className="space-y-1">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs text-zinc-400 truncate">
                    {bar.label}
                  </span>
                  <span className="text-xs font-medium tabular-nums text-zinc-300 ml-2 shrink-0">
                    {bar.value.toLocaleString()}
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-zinc-800/60 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${color} transition-all duration-700`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      );
    },

    DonutChart: ({ props }) => {
      const segments = props.segments ?? [];
      if (segments.length === 0) return null;
      const total =
        segments.reduce(
          (s: number, seg: { value: number }) => s + seg.value,
          0
        ) || 1;
      const size = props.size ?? 120;
      const cx = 60;
      const cy = 60;
      const r = 40;
      const circumference = 2 * Math.PI * r;

      let cumulativePct = 0;
      const arcs = segments.map(
        (
          seg: { label: string; value: number; color: string | null },
          i: number
        ) => {
          const pct = seg.value / total;
          const dashArray = `${pct * circumference} ${circumference}`;
          const rotation = cumulativePct * 360 - 90;
          cumulativePct += pct;
          const fillColor =
            FILL_COLORS[seg.color ?? "emerald"] ?? FILL_COLORS.emerald;

          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={fillColor}
              strokeWidth="18"
              strokeDasharray={dashArray}
              strokeDashoffset="0"
              transform={`rotate(${rotation} ${cx} ${cy})`}
              className="transition-all duration-500"
            />
          );
        }
      );

      return (
        <div className="flex items-center gap-5 p-3 rounded-xl bg-zinc-800/20 border border-zinc-800/40">
          <svg
            viewBox="0 0 120 120"
            style={{ width: size, height: size, flexShrink: 0 }}
          >
            {/* Background ring */}
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="#27272a"
              strokeWidth="18"
            />
            {arcs}
          </svg>
          <div className="space-y-1.5 min-w-0 overflow-hidden">
            {segments.map(
              (
                seg: { label: string; value: number; color: string | null },
                i: number
              ) => {
                const fillColor =
                  FILL_COLORS[seg.color ?? "emerald"] ?? FILL_COLORS.emerald;
                const pct = ((seg.value / total) * 100).toFixed(1);
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: fillColor }}
                    />
                    <span className="text-zinc-400 truncate">{seg.label}</span>
                    <span className="text-zinc-300 ml-auto tabular-nums shrink-0">
                      {pct}%
                    </span>
                  </div>
                );
              }
            )}
          </div>
        </div>
      );
    },

    Image: ({ props }) => {
      const roundedCls =
        props.rounded === "full"
          ? "rounded-full"
          : props.rounded === "md"
            ? "rounded-md"
            : "";
      return (
        <img
          src={props.src}
          alt={props.alt}
          width={props.width ?? undefined}
          height={props.height ?? undefined}
          loading="lazy"
          className={`object-cover ${roundedCls}`}
        />
      );
    },

    TokenRow: ({ props }) => {
      const changeVal = parseFloat(props.change ?? "");
      const isPositive = changeVal > 0;
      const isNegative = changeVal < 0;
      const sparkData = props.sparklineData ?? [];

      // Mini sparkline path
      let sparkPath = "";
      if (sparkData.length >= 2) {
        const w = 48;
        const h = 20;
        const min = Math.min(...sparkData);
        const max = Math.max(...sparkData);
        const range = max - min || 1;
        sparkPath = sparkData
          .map((v: number, i: number) => {
            const x = (i / (sparkData.length - 1)) * w;
            const y = h - ((v - min) / range) * h;
            return `${i === 0 ? "M" : "L"}${x},${y}`;
          })
          .join(" ");
      }

      const sparkColor = sparkData.length >= 2
        ? (sparkData[sparkData.length - 1] >= sparkData[0] ? "#10b981" : "#ef4444")
        : "#71717a";

      return (
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-zinc-800/30 border border-zinc-800/50 hover:bg-zinc-800/50 transition-colors group">
          {/* Logo or fallback */}
          {props.imageUrl ? (
            <img
              src={props.imageUrl}
              alt={props.name}
              width={28}
              height={28}
              loading="lazy"
              className="rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-300 shrink-0">
              {props.symbol.slice(0, 2).toUpperCase()}
            </div>
          )}

          {/* Name + symbol */}
          <div className="min-w-0 flex-shrink">
            <span className="text-sm font-medium text-zinc-200 truncate block leading-tight">{props.name}</span>
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{props.symbol}</span>
          </div>

          {/* Rank badge */}
          {props.rank != null && (
            <span className="text-[10px] text-zinc-600 tabular-nums shrink-0">#{props.rank}</span>
          )}

          {/* Mini sparkline */}
          {sparkPath && (
            <svg width="48" height="20" viewBox="0 0 48 20" className="shrink-0 ml-auto opacity-70 group-hover:opacity-100 transition-opacity">
              <path d={sparkPath} fill="none" stroke={sparkColor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          )}

          {/* Price */}
          <span className="text-sm font-semibold tabular-nums text-zinc-100 shrink-0 ml-auto">{props.price}</span>

          {/* Change badge */}
          {props.change && (
            <span
              className={`text-xs font-medium tabular-nums px-1.5 py-0.5 rounded shrink-0 ${isPositive
                ? "text-emerald-400 bg-emerald-500/10"
                : isNegative
                  ? "text-red-400 bg-red-500/10"
                  : "text-zinc-400 bg-zinc-800/50"
                }`}
            >
              {props.change}
            </span>
          )}
        </div>
      );
    },

    HeatMap: ({ props }) => {
      const cells = props.cells ?? [];
      if (cells.length === 0) return null;

      const values = cells.map((c: { value: number }) => c.value);
      const minVal = Math.min(...values);
      const maxVal = Math.max(...values);
      const range = maxVal - minVal || 1;

      const cols = props.columns ?? Math.min(Math.ceil(Math.sqrt(cells.length)), 6);

      return (
        <div
          className="grid gap-1 rounded-xl overflow-hidden"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {cells.map((cell: { label: string; value: number; weight: number | null }, i: number) => {
            const norm = (cell.value - minVal) / range; // 0 to 1
            // Red (0) → neutral (0.5) → green (1)
            const r = norm < 0.5 ? 239 : Math.round(239 - (norm - 0.5) * 2 * (239 - 16));
            const g = norm < 0.5 ? Math.round(68 + norm * 2 * (185 - 68)) : 185;
            const b = norm < 0.5 ? Math.round(68 + norm * 2 * (129 - 68)) : 129;

            const span = cell.weight != null && cell.weight > 1 ? Math.min(Math.round(cell.weight), cols) : 1;

            return (
              <div
                key={i}
                className="flex flex-col items-center justify-center min-h-[52px] px-2 py-2 rounded-lg"
                style={{
                  backgroundColor: `rgba(${r}, ${g}, ${b}, 0.15)`,
                  borderLeft: `3px solid rgba(${r}, ${g}, ${b}, 0.5)`,
                  gridColumn: span > 1 ? `span ${span}` : undefined,
                }}
              >
                <span className="text-[10px] text-zinc-400 truncate max-w-full">{cell.label}</span>
                <span
                  className="text-sm font-semibold tabular-nums"
                  style={{ color: `rgb(${r}, ${g}, ${b})` }}
                >
                  {cell.value >= 0 ? "+" : ""}{cell.value.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      );
    },

    ScoreRing: ({ props }) => {
      const score = Math.max(0, Math.min(100, props.score));
      const sizes = { sm: 80, md: 120, lg: 160 };
      const dim = sizes[props.size ?? "md"] ?? sizes.md;
      const strokeW = dim < 100 ? 6 : 8;
      const r = (dim - strokeW * 2) / 2;
      const circumference = 2 * Math.PI * r;
      const color = STROKE_COLORS[props.color ?? "emerald"] ?? STROKE_COLORS.emerald;
      const arcRef = useRef<SVGCircleElement>(null);

      useEffect(() => {
        const el = arcRef.current;
        if (!el) return;
        // Start fully hidden
        el.style.strokeDashoffset = String(circumference);
        // Animate to target on next frame
        requestAnimationFrame(() => {
          el.style.transition = "stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1)";
          el.style.strokeDashoffset = String(circumference * (1 - score / 100));
        });
      }, [score, circumference]);

      const fontSize = dim < 100 ? "text-lg" : dim < 140 ? "text-2xl" : "text-3xl";

      return (
        <div className="flex flex-col items-center gap-1">
          <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`}>
            {/* Background ring */}
            <circle
              cx={dim / 2}
              cy={dim / 2}
              r={r}
              fill="none"
              stroke="#27272a"
              strokeWidth={strokeW}
            />
            {/* Animated arc */}
            <circle
              ref={arcRef}
              cx={dim / 2}
              cy={dim / 2}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={strokeW}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference}
              transform={`rotate(-90 ${dim / 2} ${dim / 2})`}
              style={{ filter: `drop-shadow(0 0 6px ${color})` }}
            />
            {/* Center text */}
            <text
              x="50%"
              y="46%"
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#fafafa"
              className={`${fontSize} font-bold tabular-nums`}
              style={{ fontSize: dim < 100 ? 20 : dim < 140 ? 28 : 36 }}
            >
              {score}
            </text>
            <text
              x="50%"
              y={dim < 100 ? "64%" : "62%"}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#71717a"
              style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }}
            >
              {props.label}
            </text>
          </svg>
        </div>
      );
    },

    GlowCard: ({ props, children }) => {
      const intensity = props.intensity ?? "medium";
      const cls = `glow-card-${intensity}`;
      return (
        <div className={`relative rounded-2xl border border-zinc-700 p-[1px] ${cls}`}>
          <div className="relative z-10 rounded-2xl bg-zinc-950 p-5">
            {children}
          </div>
        </div>
      );
    },

    DivergenceBar: ({ props }) => {
      const max = props.maxValue ?? Math.max(props.leftValue, props.rightValue, 1);
      const leftPct = Math.min(100, (props.leftValue / max) * 100);
      const rightPct = Math.min(100, (props.rightValue / max) * 100);
      const gap = Math.abs(props.leftValue - props.rightValue);
      const gapPct = ((gap / max) * 100).toFixed(1);

      return (
        <div className="space-y-1.5">
          {/* Gap label */}
          <div className="text-center">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Gap: {gapPct}%
            </span>
          </div>
          {/* Bar */}
          <div className="flex items-center gap-0.5 h-6">
            {/* Left side (grows ←) */}
            <div className="flex-1 flex justify-end">
              <div className="flex items-center gap-1.5 w-full">
                <span className="text-[10px] text-cyan-400 truncate shrink-0">{props.leftLabel}</span>
                <div className="flex-1 h-4 rounded-l-full bg-zinc-800/40 overflow-hidden flex justify-end">
                  <div
                    className="h-full rounded-l-full bg-gradient-to-l from-cyan-500/80 to-cyan-500/30"
                    style={{ width: `${leftPct}%` }}
                  />
                </div>
              </div>
            </div>
            {/* Center divider */}
            <div className="w-px h-6 bg-zinc-600 shrink-0" />
            {/* Right side (grows →) */}
            <div className="flex-1">
              <div className="flex items-center gap-1.5 w-full">
                <div className="flex-1 h-4 rounded-r-full bg-zinc-800/40 overflow-hidden">
                  <div
                    className="h-full rounded-r-full bg-gradient-to-r from-emerald-500/30 to-emerald-500/80"
                    style={{ width: `${rightPct}%` }}
                  />
                </div>
                <span className="text-[10px] text-emerald-400 truncate shrink-0">{props.rightLabel}</span>
              </div>
            </div>
          </div>
          {/* Values */}
          <div className="flex justify-between">
            <span className="text-xs tabular-nums text-cyan-400/80">{props.leftValue.toFixed(1)}%</span>
            <span className="text-xs tabular-nums text-emerald-400/80">{props.rightValue.toFixed(1)}%</span>
          </div>
        </div>
      );
    },

    AlertBanner: ({ props }) => {
      const severity = props.severity ?? "info";

      const styles: Record<string, { bg: string; border: string; icon: string; glow: string; iconColor: string }> = {
        alpha: {
          bg: "bg-gradient-to-r from-emerald-950/50 to-emerald-900/20",
          border: "border-emerald-500/30",
          glow: "alert-glow-emerald",
          iconColor: "#10b981",
          icon: "M13 10V3L4 14h7v7l9-11h-7z", // lightning bolt
        },
        warning: {
          bg: "bg-gradient-to-r from-amber-950/50 to-amber-900/20",
          border: "border-amber-500/30",
          glow: "alert-glow-amber",
          iconColor: "#f59e0b",
          icon: "M12 2L1 21h22L12 2zm0 4l7.5 13h-15L12 6z", // triangle
        },
        critical: {
          bg: "bg-gradient-to-r from-red-950/50 to-red-900/20",
          border: "border-red-500/30",
          glow: "alert-glow-red",
          iconColor: "#ef4444",
          icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-2h2v2h-2zm0-4V7h2v6h-2z", // exclamation circle
        },
        info: {
          bg: "bg-gradient-to-r from-cyan-950/50 to-cyan-900/20",
          border: "border-cyan-500/30",
          glow: "alert-glow-cyan",
          iconColor: "#06b6d4",
          icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z", // info circle
        },
      };

      const s = styles[severity] ?? styles.info;

      return (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${s.border} ${s.bg} ${s.glow}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill={s.iconColor} className="shrink-0 mt-0.5">
            <path d={s.icon} />
          </svg>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-100">{props.title}</p>
            <p className="text-xs text-zinc-400 mt-0.5">{props.message}</p>
          </div>
        </div>
      );
    },

    RadarChart: ({ props }) => {
      const axes = props.axes ?? [];
      if (axes.length < 3) return null;

      const size = props.size ?? 200;
      const cx = size / 2;
      const cy = size / 2;
      const maxR = size / 2 - 30; // leave room for labels
      const color = STROKE_COLORS[props.color ?? "emerald"] ?? STROKE_COLORS.emerald;
      const n = axes.length;
      const rings = 4;

      // Compute vertices
      const getPoint = (index: number, ratio: number) => {
        const angle = (Math.PI * 2 * index) / n - Math.PI / 2;
        return {
          x: cx + Math.cos(angle) * maxR * ratio,
          y: cy + Math.sin(angle) * maxR * ratio,
        };
      };

      // Grid rings
      const gridRings = Array.from({ length: rings }, (_, ri) => {
        const ratio = (ri + 1) / rings;
        const pts = Array.from({ length: n }, (_, i) => getPoint(i, ratio));
        return pts.map((p) => `${p.x},${p.y}`).join(" ");
      });

      // Spokes
      const spokes = Array.from({ length: n }, (_, i) => {
        const p = getPoint(i, 1);
        return { x1: cx, y1: cy, x2: p.x, y2: p.y };
      });

      // Data polygon
      const dataPoints = axes.map((axis: { value: number; max: number | null }, i: number) => {
        const max = axis.max ?? 100;
        const ratio = Math.max(0, Math.min(1, axis.value / max));
        return getPoint(i, ratio);
      });
      const dataPolygon = dataPoints.map((p: { x: number; y: number }) => `${p.x},${p.y}`).join(" ");

      // Labels
      const labels = axes.map((axis: { label: string }, i: number) => {
        const p = getPoint(i, 1.18);
        return { x: p.x, y: p.y, text: axis.label };
      });

      return (
        <div className="flex justify-center p-3 rounded-xl bg-zinc-800/20 border border-zinc-800/40">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {/* Grid rings */}
            {gridRings.map((pts, i) => (
              <polygon
                key={`ring-${i}`}
                points={pts}
                fill="none"
                stroke="#27272a"
                strokeWidth="1"
              />
            ))}
            {/* Spokes */}
            {spokes.map((s, i) => (
              <line
                key={`spoke-${i}`}
                x1={s.x1}
                y1={s.y1}
                x2={s.x2}
                y2={s.y2}
                stroke="#27272a"
                strokeWidth="1"
              />
            ))}
            {/* Data polygon fill */}
            <polygon
              points={dataPolygon}
              fill={color}
              fillOpacity="0.15"
              stroke={color}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {/* Vertex dots */}
            {dataPoints.map((p: { x: number; y: number }, i: number) => (
              <circle key={`dot-${i}`} cx={p.x} cy={p.y} r="3" fill={color} />
            ))}
            {/* Axis labels */}
            {labels.map((l: { x: number; y: number; text: string }, i: number) => (
              <text
                key={`label-${i}`}
                x={l.x}
                y={l.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#a1a1aa"
                style={{ fontSize: 10 }}
              >
                {l.text}
              </text>
            ))}
          </svg>
        </div>
      );
    },

    TextField: ({ props }) => {
      const binding = useStateBinding(props.valuePath);
      const value = (binding?.[0] as string | undefined) ?? "";
      const setValue = binding?.[1] as ((v: unknown) => void) | undefined;
      return (
        <div className="space-y-1.5">
          {props.label && (
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider">
              {props.label}
            </label>
          )}
          <input
            type="text"
            value={value}
            onChange={(e) => setValue?.(e.target.value)}
            placeholder={props.placeholder ?? undefined}
            className="w-full border border-zinc-800 rounded-xl bg-zinc-900/50 px-4 py-2.5 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-zinc-700 transition-all text-sm font-mono"
          />
        </div>
      );
    },
    Widget: ({ props }) => {
      const type = props.type;
      const coinId = props.coinId || "bitcoin";
      const currency = props.currency || "usd";
      const height = props.height || 400;

      const tagMap: Record<string, string> = {
        "price-chart": "coingecko-coin-price-chart-widget",
        "heatmap": "coingecko-coin-heatmap-widget",
        "ticker-list": "coingecko-coin-market-ticker-list-widget",
        "converter": "coingecko-coin-converter-widget",
      };

      const Tag = tagMap[type] as any;
      if (!Tag) return null;

      return (
        <div className="w-full rounded-xl overflow-hidden border border-zinc-800 bg-black/20">
          <Script src="https://widgets.coingecko.com/coingecko-coin-price-chart-widget.js" strategy="afterInteractive" />
          <Script src="https://widgets.coingecko.com/coingecko-coin-heatmap-widget.js" strategy="afterInteractive" />
          <Script src="https://widgets.coingecko.com/coingecko-coin-market-ticker-list-widget.js" strategy="afterInteractive" />
          <Script src="https://widgets.coingecko.com/coingecko-coin-converter-widget.js" strategy="afterInteractive" />
          <Tag
            coin-id={coinId}
            currency={currency}
            height={height}
            locale="en"
          />
        </div>
      );
    },
    DegenGauge: ({ props }) => {
      const score = Math.max(0, Math.min(100, props.score));
      const sizes = { sm: 120, md: 180, lg: 240 };
      const dim = sizes[props.size ?? "md"] ?? sizes.md;
      const strokeW = dim * 0.1;
      const r = (dim - strokeW * 2) / 2;
      const arcLen = Math.PI * r; // half circle
      const color = STROKE_COLORS[props.color ?? "emerald"] ?? STROKE_COLORS.emerald;

      const needleAngle = (score / 100) * 180 - 180; // -180 to 0

      return (
        <div className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/60 shadow-xl overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/80 to-transparent pointer-events-none" />
          <svg width={dim} height={dim / 1.5} viewBox={`0 0 ${dim} ${dim / 1.5}`} className="relative z-10">
            <defs>
              <linearGradient id="gauge-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="50%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#ef4444" />
              </linearGradient>
            </defs>
            {/* Background track */}
            <path
              d={`M ${strokeW},${dim / 2} A ${r},${r} 0 0 1 ${dim - strokeW},${dim / 2}`}
              fill="none"
              stroke="#27272a"
              strokeWidth={strokeW}
              strokeLinecap="round"
            />
            {/* Value track */}
            <path
              d={`M ${strokeW},${dim / 2} A ${r},${r} 0 0 1 ${dim - strokeW},${dim / 2}`}
              fill="none"
              stroke="url(#gauge-grad)"
              strokeWidth={strokeW}
              strokeLinecap="round"
              strokeDasharray={arcLen}
              strokeDashoffset={arcLen * (1 - score / 100)}
              className="transition-all duration-1000 ease-out"
            />
            {/* Needle */}
            <g transform={`rotate(${needleAngle} ${dim / 2} ${dim / 2})`} className="transition-transform duration-1000 ease-out">
              <line
                x1={dim / 2}
                y1={dim / 2}
                x2={strokeW * 1.5}
                y2={dim / 2}
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                style={{ filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.5))' }}
              />
              <circle cx={dim / 2} cy={dim / 2} r="4" fill="white" />
            </g>
          </svg>
          <div className="text-center relative z-10 -mt-4">
            <span className="text-3xl font-bold text-white tabular-nums drop-shadow-md">{score}</span>
            <span className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-[0.2em] mt-1">{props.label}</span>
          </div>
        </div>
      );
    },
    WhaleRadar: ({ props }) => {
      const size = props.size ?? 220;
      const color = STROKE_COLORS[props.color ?? "emerald"] ?? STROKE_COLORS.emerald;
      const points = props.points ?? [];

      return (
        <div className="flex justify-center p-4 rounded-2xl bg-black/40 border border-zinc-800/60 relative overflow-hidden group">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_transparent_0%,_rgba(0,0,0,0.4)_100%)] pointer-events-none" />
          <svg width={size} height={size} viewBox="0 0 200 200" className="relative z-10">
            {/* Grid circles */}
            {[40, 70, 100].map((r, i) => (
              <circle key={i} cx="100" cy="100" r={r} fill="none" stroke={color} strokeWidth="0.5" strokeOpacity={0.2 - i * 0.05} />
            ))}
            {/* Axis lines */}
            <line x1="0" y1="100" x2="200" y2="100" stroke={color} strokeWidth="0.5" strokeOpacity="0.1" />
            <line x1="100" y1="0" x2="100" y2="200" stroke={color} strokeWidth="0.5" strokeOpacity="0.1" />

            {/* Radar sweep */}
            <g className="animate-radar-sweep origin-center">
              <path
                d="M 100,100 L 100,0 A 100,100 0 0 1 200,100 Z"
                fill={`url(#radar-sweep-grad)`}
                fillOpacity="0.4"
              />
              <defs>
                <radialGradient id="radar-sweep-grad" cx="100" cy="100" r="100" fx="100" fy="50">
                  <stop offset="0%" stopColor={color} stopOpacity="0.6" />
                  <stop offset="100%" stopColor={color} stopOpacity="0" />
                </radialGradient>
              </defs>
              <line x1="100" y1="100" x2="100" y2="0" stroke={color} strokeWidth="1.5" strokeOpacity="0.8" />
            </g>

            {/* Points (Whales) */}
            {points.map((p, i) => {
              // Map x/y (-1 to 1) to 0-200
              const cx = 100 + p.x * 90;
              const cy = 100 + p.y * 90;
              const r = 2 + (p.size / 100) * 8;
              return (
                <g key={i}>
                  <circle cx={cx} cy={cy} r={r} fill={color} className="animate-pulse">
                    <title>{p.label}</title>
                  </circle>
                  <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke={color} strokeWidth="1" strokeOpacity="0.3" className="animate-ping" />
                  {p.label && (
                    <text x={cx} y={cy - r - 4} textAnchor="middle" fill={color} style={{ fontSize: 6, fontWeight: 'bold', textShadow: '0 0 2px black' }}>
                      {p.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <style jsx>{`
            @keyframes radar-sweep {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
            .animate-radar-sweep {
              animation: radar-sweep 4s linear infinite;
            }
          `}</style>
        </div>
      );
    },
    SocialLinks: ({ props }) => {
      const iconMap: Record<string, React.ReactNode> = {
        x: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        ),
        telegram: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
          </svg>
        ),
        discord: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><path d="M9 8a2 2 0 0 0-1.29 3.53C6.76 12.55 6 13.9 6 15.5a2.5 2.5 0 0 0 5 0v-4.5" /><path d="M15 8a2 2 0 0 1 1.29 3.53C17.24 12.55 18 13.9 18 15.5a2.5 2.5 0 0 1-5 0v-4.5" /><path d="M8 12h8" />
          </svg>
        ),
        github: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
          </svg>
        ),
        website: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        ),
      };

      return (
        <div className="flex flex-wrap gap-2">
          {props.links.map((link, i) => (
            <a
              key={i}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-800/40 border border-zinc-700/50 hover:bg-zinc-700/50 hover:border-zinc-500/50 transition-all text-xs text-zinc-300 font-medium group"
            >
              <span className="text-zinc-500 group-hover:text-zinc-200 transition-colors">
                {iconMap[link.type] ?? iconMap.website}
              </span>
              {link.label || link.type.charAt(0).toUpperCase() + link.type.slice(1)}
            </a>
          ))}
        </div>
      );
    },
  },
});
