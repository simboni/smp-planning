"use client";

/**
 * Module 10 — shared hand-rolled SVG chart primitives.
 *
 * No chart libraries: every mark is plain SVG driven by the design
 * tokens, so charts stay crisp, brand-colored and dark-safe. Follows
 * the house dataviz rules: thin marks with rounded data-ends, 2px
 * surface gaps between fills, recessive grid, text in ink tokens
 * (never the series color), a legend whenever two series share a plot,
 * and native <title> hover hints on every mark.
 *
 * Used by the dashboard cards and the sprint report page.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { formatShortDate } from "@/lib/format";

/**
 * Measure a container's width so the SVG viewBox can match it 1:1 —
 * marks stay crisp and text keeps its size at any card width (a fixed
 * viewBox would letterbox inside wide cards). SSR-safe: starts at the
 * fallback and corrects after mount.
 */
function useMeasuredWidth<T extends HTMLElement>(
  fallback: number,
): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (): void => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(Math.max(Math.round(w), 260));
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/* ------------------------------------------------------------------ *
 * Shared bits.
 * ------------------------------------------------------------------ */

/** A colored-dot legend row (identity is never color-alone). */
export function ChartLegend({
  items,
}: {
  items: { label: string; color: string; dashed?: boolean; value?: string }[];
}): ReactElement {
  return (
    <div className="chart-legend">
      {items.map((it) => (
        <span key={it.label} className="chart-legend-item">
          {it.dashed ? (
            <span className="chart-legend-dash" style={{ color: it.color }} />
          ) : (
            <span className="chart-legend-dot" style={{ background: it.color }} />
          )}
          <span className="chart-legend-label">{it.label}</span>
          {it.value !== undefined && (
            <span className="chart-legend-value">{it.value}</span>
          )}
        </span>
      ))}
    </div>
  );
}

/** Friendly in-card empty state ("No data yet"). */
export function ChartEmpty({ children }: { children: React.ReactNode }): ReactElement {
  return <div className="chart-empty">{children}</div>;
}

/** Round a max value up to a friendly axis ceiling (1/2/5 × 10^k). */
function niceCeil(value: number): number {
  const v = Math.max(1, value);
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (v <= m * mag) return m * mag;
  }
  return 10 * mag;
}

/* ------------------------------------------------------------------ *
 * Donut — share-of-whole (status breakdown). SVG circle segments with
 * a 2px surface gap between slices and the total in the hole.
 * ------------------------------------------------------------------ */
export function Donut({
  slices,
  size = 148,
  centerLabel = "tasks",
}: {
  slices: { label: string; color: string; count: number }[];
  size?: number;
  centerLabel?: string;
}): ReactElement {
  const visible = slices.filter((s) => s.count > 0);
  const total = visible.reduce((n, s) => n + s.count, 0);

  // r chosen so the circumference is exactly 100 — percentages map
  // straight onto stroke-dasharray units.
  const R = 15.9155;
  const gap = visible.length > 1 ? 1.6 : 0;

  let cum = 0;
  const segs = visible.map((s) => {
    const pct = (s.count / total) * 100;
    const seg = {
      ...s,
      dash: Math.max(pct - gap, 0.5),
      offset: 25 - cum - gap / 2,
      pct,
    };
    cum += pct;
    return seg;
  });

  return (
    <svg
      className="donut"
      viewBox="0 0 42 42"
      width={size}
      height={size}
      role="img"
      aria-label={`Donut chart, ${total} total`}
    >
      {/* recessive track ring */}
      <circle
        cx="21"
        cy="21"
        r={R}
        fill="none"
        stroke="var(--line-soft)"
        strokeWidth="4.6"
      />
      {segs.map((s) => (
        <circle
          key={s.label}
          cx="21"
          cy="21"
          r={R}
          fill="none"
          stroke={s.color}
          strokeWidth="4.6"
          strokeDasharray={`${s.dash} ${100 - s.dash}`}
          strokeDashoffset={s.offset}
          strokeLinecap="butt"
        >
          <title>{`${s.label} — ${s.count} (${Math.round(s.pct)}%)`}</title>
        </circle>
      ))}
      <text
        x="21"
        y="20.6"
        textAnchor="middle"
        className="donut-total"
        fill="var(--ink)"
      >
        {total}
      </text>
      <text
        x="21"
        y="26"
        textAnchor="middle"
        className="donut-sub"
        fill="var(--muted)"
      >
        {centerLabel}
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Bars — vertical bar chart (daily time tracked, sprint velocity).
 * Thin marks, rounded top data-ends anchored to the baseline, hover
 * <title> per bar, selective value label on the tallest bar.
 * ------------------------------------------------------------------ */
export function Bars({
  points,
  color = "var(--brand)",
  height = 170,
  formatValue = (v: number) => String(v),
}: {
  points: { label: string; value: number; hint?: string; highlight?: boolean }[];
  color?: string;
  height?: number;
  formatValue?: (v: number) => string;
}): ReactElement {
  const [wrapRef, W] = useMeasuredWidth<HTMLDivElement>(560);
  const H = height;
  const padL = 30;
  const padR = 8;
  const padT = 18;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const n = points.length;
  const maxY = niceCeil(Math.max(...points.map((p) => p.value), 1));
  const step = plotW / Math.max(n, 1);
  const barW = Math.min(Math.max(step - 2, 3), 34);
  const maxIdx = points.reduce(
    (best, p, i) => (p.value > points[best].value ? i : best),
    0,
  );
  // When one bar is highlighted, the rest recede; otherwise all full.
  const anyHighlight = points.some((p) => p.highlight);

  // Which x labels fit: all when few, first/middle/last otherwise.
  const labelIdx = new Set<number>(
    n <= 8
      ? points.map((_, i) => i)
      : [0, Math.floor((n - 1) / 2), n - 1],
  );

  const y = (v: number): number => padT + plotH - (v / maxY) * plotH;

  return (
    <div ref={wrapRef} className="chart-wrap">
    <svg
      className="chart-svg"
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto" }}
      role="img"
      aria-label="Bar chart"
    >
      {/* recessive gridlines */}
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line
          key={f}
          x1={padL}
          x2={W - padR}
          y1={y(maxY * f)}
          y2={y(maxY * f)}
          stroke="var(--line-soft)"
          strokeWidth="1"
        />
      ))}
      {/* y extents in ink tokens */}
      <text x={padL - 6} y={y(maxY) + 3.5} textAnchor="end" className="chart-tick" fill="var(--muted)">
        {formatValue(maxY)}
      </text>
      <text x={padL - 6} y={y(0) + 3.5} textAnchor="end" className="chart-tick" fill="var(--muted)">
        0
      </text>

      {points.map((p, i) => {
        const cx = padL + step * i + step / 2;
        const barH = Math.max((p.value / maxY) * plotH, p.value > 0 ? 2 : 0);
        const top = padT + plotH - barH;
        const r = Math.min(3, barW / 2, barH);
        const isMax = i === maxIdx && p.value > 0;
        return (
          <g key={`${p.label}-${i}`} className="chart-bar-g">
            {/* generous invisible hit target */}
            <rect x={cx - step / 2} y={padT} width={step} height={plotH} fill="transparent">
              <title>{p.hint ?? `${p.label} — ${formatValue(p.value)}`}</title>
            </rect>
            {p.value > 0 ? (
              // rounded top only, flat base anchored to the baseline
              <path
                d={`M ${cx - barW / 2} ${padT + plotH}
                    V ${top + r}
                    Q ${cx - barW / 2} ${top} ${cx - barW / 2 + r} ${top}
                    H ${cx + barW / 2 - r}
                    Q ${cx + barW / 2} ${top} ${cx + barW / 2} ${top + r}
                    V ${padT + plotH} Z`}
                fill={color}
                opacity={anyHighlight && !p.highlight ? 0.35 : 1}
                pointerEvents="none"
              />
            ) : (
              <rect
                x={cx - barW / 2}
                y={padT + plotH - 1.5}
                width={barW}
                height={1.5}
                rx={0.75}
                fill="var(--line)"
                pointerEvents="none"
              />
            )}
            {isMax && (
              <text x={cx} y={top - 5} textAnchor="middle" className="chart-tick" fill="var(--ink-2)">
                {formatValue(p.value)}
              </text>
            )}
            {labelIdx.has(i) && (
              <text x={cx} y={H - 8} textAnchor="middle" className="chart-tick" fill="var(--muted)">
                {p.label}
              </text>
            )}
          </g>
        );
      })}
      {/* baseline */}
      <line
        x1={padL}
        x2={W - padR}
        y1={padT + plotH}
        y2={padT + plotH}
        stroke="var(--line)"
        strokeWidth="1"
      />
    </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * HBars — labeled horizontal bars (priority breakdown). Each row is
 * directly labeled with name + count so identity never rides on color.
 * ------------------------------------------------------------------ */
export function HBars({
  rows,
}: {
  rows: { label: string; color: string; count: number }[];
}): ReactElement {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div key={r.label} className="hbar-row" title={`${r.label} — ${r.count}`}>
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-track">
            <span
              className="hbar-fill"
              style={{
                width: `${Math.max((r.count / max) * 100, r.count > 0 ? 3 : 0)}%`,
                background: r.color,
              }}
            />
          </span>
          <span className="hbar-count">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * LineChart — the burndown. Ideal as a dashed grey guide, actual as a
 * brand-purple line with surface-ringed dots and a soft area fill.
 * ------------------------------------------------------------------ */
export function LineChart({
  days,
  totalPoints,
  height = 220,
  unit = "pts",
}: {
  days: { date: string; remainingPoints: number | null; idealRemaining: number }[];
  totalPoints: number;
  height?: number;
  unit?: string;
}): ReactElement {
  const [wrapRef, W] = useMeasuredWidth<HTMLDivElement>(600);
  const H = height;
  const padL = 34;
  const padR = 14;
  const padT = 16;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const n = days.length;
  const maxY = niceCeil(
    Math.max(
      Number(totalPoints) || 0,
      ...days.map((d) => Number(d.idealRemaining) || 0),
      ...days.map((d) => (d.remainingPoints === null ? 0 : Number(d.remainingPoints) || 0)),
      1,
    ),
  );

  const x = (i: number): number =>
    n <= 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW;
  const y = (v: number): number => padT + plotH - (v / maxY) * plotH;

  const idealPts = days.map((d, i) => `${x(i)},${y(Number(d.idealRemaining) || 0)}`);
  const actual = days
    .map((d, i) => ({ i, v: d.remainingPoints === null ? null : Number(d.remainingPoints) }))
    .filter((p): p is { i: number; v: number } => p.v !== null && Number.isFinite(p.v));
  const actualPts = actual.map((p) => `${x(p.i)},${y(p.v)}`);
  const last = actual.length > 0 ? actual[actual.length - 1] : null;

  // Soft area under the actual line, closed down to the baseline.
  const areaPath =
    actual.length > 1
      ? `M ${actualPts.join(" L ")} L ${x(actual[actual.length - 1].i)},${y(0)} L ${x(actual[0].i)},${y(0)} Z`
      : "";

  return (
    <div ref={wrapRef} className="chart-wrap">
    <svg
      className="chart-svg"
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto" }}
      role="img"
      aria-label="Burndown chart"
    >
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line
          key={f}
          x1={padL}
          x2={W - padR}
          y1={y(maxY * f)}
          y2={y(maxY * f)}
          stroke="var(--line-soft)"
          strokeWidth="1"
        />
      ))}
      <text x={padL - 7} y={y(maxY) + 3.5} textAnchor="end" className="chart-tick" fill="var(--muted)">
        {maxY}
      </text>
      <text x={padL - 7} y={y(0) + 3.5} textAnchor="end" className="chart-tick" fill="var(--muted)">
        0
      </text>

      {/* per-day hover hints */}
      {days.map((d, i) => {
        const remaining =
          d.remainingPoints === null ? null : Number(d.remainingPoints);
        return (
          <rect
            key={d.date}
            x={n <= 1 ? padL : x(i) - plotW / Math.max(n - 1, 1) / 2}
            y={padT}
            width={n <= 1 ? plotW : plotW / Math.max(n - 1, 1)}
            height={plotH}
            fill="transparent"
          >
            <title>
              {`${formatShortDate(d.date)} — ${
                remaining === null ? "not reached" : `${remaining} ${unit} left`
              } · ideal ${Math.round((Number(d.idealRemaining) || 0) * 10) / 10}`}
            </title>
          </rect>
        );
      })}

      {areaPath && <path d={areaPath} fill="var(--brand)" opacity="0.08" pointerEvents="none" />}

      {/* ideal guide — dashed, recessive */}
      {idealPts.length > 1 && (
        <polyline
          points={idealPts.join(" ")}
          fill="none"
          stroke="var(--muted)"
          strokeWidth="1.5"
          strokeDasharray="5 5"
          strokeLinecap="round"
          opacity="0.7"
          pointerEvents="none"
        />
      )}

      {/* actual — brand line with surface-ringed markers */}
      {actualPts.length > 1 && (
        <polyline
          points={actualPts.join(" ")}
          fill="none"
          stroke="var(--brand)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      )}
      {actual.map((p) => (
        <circle
          key={p.i}
          cx={x(p.i)}
          cy={y(p.v)}
          r={last && p.i === last.i ? 4 : 2.6}
          fill="var(--brand)"
          stroke="var(--card)"
          strokeWidth="1.6"
          pointerEvents="none"
        />
      ))}

      {/* baseline + x extents */}
      <line
        x1={padL}
        x2={W - padR}
        y1={padT + plotH}
        y2={padT + plotH}
        stroke="var(--line)"
        strokeWidth="1"
      />
      {n > 0 && (
        <>
          <text x={padL} y={H - 8} textAnchor="start" className="chart-tick" fill="var(--muted)">
            {formatShortDate(days[0].date)}
          </text>
          {n > 1 && (
            <text x={W - padR} y={H - 8} textAnchor="end" className="chart-tick" fill="var(--muted)">
              {formatShortDate(days[n - 1].date)}
            </text>
          )}
        </>
      )}
    </svg>
    </div>
  );
}
