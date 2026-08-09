"use client";

// The answer half of the assistant, rendered as a small dashboard. The model
// picks the widgets; this file makes them feel placed rather than dumped:
// cards float in one after another, bars grow, donuts sweep open, lines draw
// themselves, headline numbers count up. All CSS/SVG — no chart library.
import { useEffect, useState } from "react";
import Link from "next/link";
import type { AskResult, Widget } from "@/lib/ai/ask-schema";
import { diversifyWidgets } from "@/lib/ai/widget-variety";
import { normalizeInAppHref } from "@/lib/ask-links";
import { cn } from "@/lib/utils";

const SPAN: Record<number, string> = {
  1: "md:col-span-1",
  2: "md:col-span-2",
  3: "md:col-span-3",
};

const ROW_LINK =
  "flex w-full items-center gap-2 rounded-md px-1 py-1.5 -mx-1 text-primary transition-colors hover:bg-hover hover:underline";

/** Entity accents, in the order series pick them up — never a generated palette. */
const SERIES_COLORS = [
  "oklch(0.58 0.14 245)", // projects blue
  "oklch(0.58 0.17 300)", // goals purple
  "oklch(0.6 0.13 155)", // habits green
  "oklch(0.7 0.12 70)", // notes amber
  "oklch(0.64 0.18 25)", // tasks red
  "oklch(0.55 0.16 274)", // primary indigo
];

const seriesColor = (i: number) => SERIES_COLORS[i % SERIES_COLORS.length];

export function AskDashboard({
  result,
  hideAnswer = false,
}: {
  result: AskResult;
  /** The workspace header already shows the sentence; don't repeat it. */
  hideAnswer?: boolean;
}) {
  const widgets = diversifyWidgets(result.widgets);
  return (
    <div>
      {!hideAnswer && (
        <p className="mb-4 text-[14px] leading-relaxed text-ink">
          {result.answer}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {widgets.map((w, i) => (
          <div
            key={i}
            className={cn(
              "ask-card-in",
              SPAN[Number(w.span)] ?? "md:col-span-1",
            )}
            style={{ animationDelay: `${i * 90}ms` }}
          >
            <WidgetCard widget={w} index={i} />
          </div>
        ))}
      </div>
      <div className="mt-4 font-mono text-[10px] text-faint">
        analyzed{" "}
        {result.dataMode === "full" ? "your full data" : "your recent data"}
      </div>
    </div>
  );
}

function Card({
  title,
  accent,
  children,
}: {
  title: string;
  /** Optional top-edge tint so each card reads as its own thing. */
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex h-full flex-col rounded-[12px] border border-border bg-surface p-3.5 shadow-sm"
      style={accent ? { borderTop: `3px solid ${accent}` } : undefined}
    >
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-faint">
        {title}
      </div>
      {children}
    </div>
  );
}

function FocusRow({
  href,
  label,
  sublabel,
  className,
  children,
}: {
  href?: string | null;
  label: string;
  sublabel?: string | null;
  className?: string;
  children?: React.ReactNode;
}) {
  const valid = normalizeInAppHref(href);
  const content = children ?? (
    <>
      <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
      {sublabel ? (
        <span className="shrink-0 font-mono text-[10px] text-faint">
          {sublabel}
        </span>
      ) : null}
    </>
  );

  if (valid) {
    return (
      <Link href={valid} className={cn(ROW_LINK, className)}>
        {content}
      </Link>
    );
  }

  return (
    <div
      className={cn(
        "flex w-full items-center gap-2 px-1 py-1.5 -mx-1 text-ink",
        className,
      )}
    >
      {content}
    </div>
  );
}

/**
 * Counts a stat up from zero. Works on the first number inside the string
 * ("17", "78%", "3 / 8" → the 3) and leaves pure-text values alone.
 */
function useCountUp(value: string): string {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  const [display, setDisplay] = useState(() =>
    match ? value.replace(match[0], "0") : value,
  );
  useEffect(() => {
    const m = value.match(/-?\d+(?:\.\d+)?/);
    if (!m) {
      setDisplay(value);
      return;
    }
    const target = parseFloat(m[0]);
    const decimals = (m[0].split(".")[1] ?? "").length;
    const t0 = performance.now();
    const duration = 700;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(value.replace(m[0], (target * eased).toFixed(decimals)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return display;
}

function StatCard({
  widget,
  index,
}: {
  widget: Extract<Widget, { type: "stat" }>;
  index: number;
}) {
  const display = useCountUp(widget.value);
  const color = seriesColor(index);
  return (
    <Card title={widget.title} accent={color}>
      <div className="flex flex-1 flex-col justify-center">
        <div
          className="text-[34px] font-extrabold leading-none tracking-tight"
          style={{ color }}
        >
          {display}
        </div>
        {widget.label && (
          <div className="mt-1.5 text-[12px] text-muted">{widget.label}</div>
        )}
        {widget.hint && (
          <div className="mt-0.5 font-mono text-[10px] text-faint">
            {widget.hint}
          </div>
        )}
      </div>
    </Card>
  );
}

function WidgetCard({ widget, index }: { widget: Widget; index: number }) {
  switch (widget.type) {
    case "stat":
      return <StatCard widget={widget} index={index} />;

    case "bar": {
      const max = Math.max(1, ...widget.series.map((s) => s.value));
      return (
        <Card title={widget.title}>
          <div className="flex flex-col divide-y divide-border2">
            {widget.series.map((s, i) => {
              const color = seriesColor(i);
              return (
                <FocusRow
                  key={i}
                  href={s.href}
                  label={s.label}
                  className="gap-2"
                >
                  <div className="w-24 shrink-0 truncate text-[11.5px] text-muted">
                    {s.label}
                  </div>
                  <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-surface2">
                    <div
                      className="ask-bar-fill h-full rounded-full"
                      style={{
                        width: `${(s.value / max) * 100}%`,
                        background: `linear-gradient(90deg, color-mix(in oklch, ${color} 62%, var(--surface2)), ${color})`,
                        ["--ask-delay" as string]: `${i * 0.12}s`,
                      }}
                    />
                  </div>
                  <div className="w-12 shrink-0 text-right font-mono text-[11px] text-ink">
                    {s.value}
                    {widget.unit ? (
                      <span className="text-faint">{widget.unit}</span>
                    ) : null}
                  </div>
                </FocusRow>
              );
            })}
          </div>
        </Card>
      );
    }

    case "list":
      return (
        <Card title={widget.title}>
          <ul className="flex flex-col divide-y divide-border2">
            {widget.items.map((item, i) => (
              <li
                key={i}
                className="ask-fade-in"
                style={{ ["--ask-delay" as string]: `${i * 0.07}s` }}
              >
                <FocusRow
                  href={item.href}
                  label={item.label}
                  sublabel={item.sublabel}
                />
              </li>
            ))}
          </ul>
        </Card>
      );

    case "calendar":
      return (
        <Card title={widget.title}>
          <MonthCalendar month={widget.month} marks={widget.marks} />
        </Card>
      );

    case "table":
      return (
        <Card title={widget.title}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  {widget.columns.map((c, i) => (
                    <th
                      key={i}
                      className="border-b border-border px-2 py-1 text-left font-mono text-[10px] uppercase tracking-wide text-faint"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {widget.rows.map((row, ri) => (
                  <tr
                    key={ri}
                    className="ask-fade-in"
                    style={{ ["--ask-delay" as string]: `${ri * 0.06}s` }}
                  >
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="border-b border-border2 px-2 py-1 text-ink"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      );

    case "pie": {
      const total = Math.max(
        1,
        widget.slices.reduce((sum, s) => sum + s.value, 0),
      );
      // stroke-dasharray donut: 15.9 radius → circumference 100, so dash
      // lengths are simply percentages. Slices sweep open in turn (.ask-arc).
      let offset = 25;
      const arcs = widget.slices.slice(0, 6).map((s, i) => {
        const pct = (s.value / total) * 100;
        const arc = { pct, offset, color: seriesColor(i), slice: s };
        offset -= pct;
        return arc;
      });
      return (
        <Card title={widget.title}>
          <div className="flex flex-wrap items-center gap-4">
            <svg
              width="108"
              height="108"
              viewBox="0 0 42 42"
              role="img"
              aria-label={widget.title}
            >
              <circle
                cx="21"
                cy="21"
                r="15.9"
                fill="none"
                stroke="var(--border)"
                strokeWidth="5.5"
              />
              {arcs.map((a, i) => (
                <circle
                  key={i}
                  className="ask-arc"
                  cx="21"
                  cy="21"
                  r="15.9"
                  fill="none"
                  stroke={a.color}
                  strokeWidth="5.5"
                  strokeDasharray={`${a.pct} ${100 - a.pct}`}
                  strokeDashoffset={a.offset}
                  strokeLinecap={a.pct < 99 ? "butt" : "round"}
                  style={{
                    ["--ask-arc" as string]: `${a.pct} ${100 - a.pct}`,
                    ["--ask-delay" as string]: `${i * 0.1}s`,
                  }}
                />
              ))}
              {widget.centerLabel && (
                <text
                  x="21"
                  y="22.6"
                  textAnchor="middle"
                  className="fill-ink font-mono font-semibold"
                  style={{ fontSize: "6px" }}
                >
                  {widget.centerLabel}
                </text>
              )}
            </svg>
            <div className="flex min-w-[140px] flex-1 flex-col gap-1.5">
              {arcs.map((a, i) => (
                <FocusRow
                  key={i}
                  href={a.slice.href}
                  label={a.slice.label}
                  className="gap-2"
                >
                  <i
                    className="h-2 w-2 shrink-0 rounded-[2px]"
                    style={{ background: a.color }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
                    {a.slice.label}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-ink">
                    {a.slice.value}
                    {widget.unit ?? ""}
                  </span>
                  <span className="w-9 shrink-0 text-right font-mono text-[10px] text-faint">
                    {Math.round(a.pct)}%
                  </span>
                </FocusRow>
              ))}
            </div>
          </div>
        </Card>
      );
    }

    case "line": {
      const points = widget.points;
      if (!points.length) return null;
      const w = 240;
      const h = 90;
      const max = Math.max(...points.map((p) => p.value), 1);
      const min = Math.min(...points.map((p) => p.value), 0);
      const range = max - min || 1;
      const color = seriesColor(index);
      const gradId = `ask-line-${index}`;
      const xy = points.map((p, i) => {
        const x =
          points.length === 1 ? w / 2 : 4 + (i * (w - 8)) / (points.length - 1);
        const y = 10 + (1 - (p.value - min) / range) * (h - 30);
        return [x, y] as const;
      });
      const coords = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`);
      const area = [
        `${xy[0][0].toFixed(1)},${h - 10}`,
        ...coords,
        `${xy.at(-1)![0].toFixed(1)},${h - 10}`,
      ].join(" ");
      return (
        <Card title={widget.title}>
          <svg
            viewBox={`0 0 ${w} ${h}`}
            width="100%"
            height={h}
            role="img"
            aria-label={widget.title}
            className="block"
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <line
              x1="0"
              y1={h - 10}
              x2={w}
              y2={h - 10}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <polygon
              points={area}
              fill={`url(#${gradId})`}
              className="ask-fade-in"
              style={{ ["--ask-delay" as string]: "0.4s" }}
            />
            <polyline
              className="ask-line-draw"
              pathLength={1}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={coords.join(" ")}
            />
            {xy.map(([x, y], i) => (
              <circle
                key={i}
                className="ask-pop-in"
                cx={x}
                cy={y}
                r={i === xy.length - 1 ? 3 : 1.8}
                fill={color}
                style={{
                  ["--ask-delay" as string]: `${0.15 + (i / xy.length) * 0.8}s`,
                  transformOrigin: `${x}px ${y}px`,
                }}
              />
            ))}
          </svg>
          <div className="mt-1 flex justify-between font-mono text-[9px] text-faint">
            <span>{points[0].label}</span>
            <span>{points.at(-1)!.label}</span>
          </div>
          {widget.unit && (
            <div className="mt-1 font-mono text-[10px] text-faint">
              {widget.unit}
            </div>
          )}
        </Card>
      );
    }

    case "progress":
      return (
        <Card title={widget.title}>
          <div className="flex flex-col gap-3">
            {widget.rows.map((row, i) => {
              const pct = Math.min(100, Math.max(0, row.percent));
              const color = seriesColor(i);
              return (
                <FocusRow
                  key={i}
                  href={row.href}
                  label={row.label}
                  className="block"
                >
                  <div className="w-full">
                    <div className="mb-1.5 flex justify-between text-[12px]">
                      <span className="truncate text-ink">{row.label}</span>
                      <span className="font-mono text-muted">
                        {Math.round(row.percent)}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-border">
                      <span
                        className="ask-bar-fill block h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: `linear-gradient(90deg, color-mix(in oklch, ${color} 62%, var(--surface2)), ${color})`,
                          ["--ask-delay" as string]: `${i * 0.12}s`,
                        }}
                      />
                    </div>
                  </div>
                </FocusRow>
              );
            })}
          </div>
        </Card>
      );

    case "text":
    default:
      return (
        <Card title={widget.title}>
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
            {(widget as { body?: string }).body ?? ""}
          </div>
        </Card>
      );
  }
}

const DOW = ["M", "T", "W", "T", "F", "S", "S"];

function MonthCalendar({
  month,
  marks,
}: {
  month: string;
  marks: { date: string; intensity?: number | null; label?: string | null }[];
}) {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return null;
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  // Monday-first offset.
  const offset = (first.getDay() + 6) % 7;
  const byDate = new Map(marks.map((mk) => [mk.date, mk]));
  const pad = (n: number) => String(n).padStart(2, "0");

  const cells: ({ day: number; mark?: (typeof marks)[number] } | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  let markSeen = 0;
  const marked: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${pad(m)}-${pad(d)}`;
    const mark = byDate.get(key);
    cells.push({ day: d, mark });
    marked.push(mark ? markSeen++ : -1);
  }

  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold text-muted">
        {first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {DOW.map((d, i) => (
          <div
            key={`h${i}`}
            className="text-center font-mono text-[8px] text-faint"
          >
            {d}
          </div>
        ))}
        {cells.map((c, i) =>
          c === null ? (
            <div key={`e${i}`} />
          ) : (
            <div
              key={c.day}
              title={c.mark?.label ?? undefined}
              className={cn(
                "flex aspect-square items-center justify-center rounded-[4px] text-[10px]",
                c.mark ? "ask-pop-in text-white" : "bg-surface2 text-faint",
              )}
              style={
                c.mark
                  ? {
                      background: `color-mix(in oklch, var(--habits) ${Math.round(
                        Math.max(0.15, Math.min(1, c.mark.intensity ?? 1)) *
                          100,
                      )}%, var(--surface2))`,
                      ["--ask-delay" as string]: `${marked[c.day - 1] * 0.04}s`,
                    }
                  : undefined
              }
            >
              {c.day}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
