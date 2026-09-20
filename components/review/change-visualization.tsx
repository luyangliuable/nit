"use client";

import * as React from "react";
import type { ChangeVisualization, VizBlock, VizDatum, VizTone } from "@/lib/shared/types";

// Renders the structured change visualization using the app's own theme tokens,
// so every chart and table follows light/dark mode automatically. There is no
// prose: only charts, diagrams and tables.

const MAX_VISIBLE_ROWS = 14;

function formatNum(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1);
}

function toneColor(tone: VizTone | undefined, i: number): string {
  switch (tone) {
    case "add":
      return "hsl(var(--success))";
    case "del":
    case "critical":
      return "hsl(var(--destructive))";
    case "warning":
      return "hsl(var(--warning))";
    default:
      return `hsl(var(--viz-${(i % 6) + 1}))`;
  }
}

export function ChangeVisualizationView({ viz }: { viz: ChangeVisualization }) {
  return (
    <div className="space-y-3 p-3">
      {viz.title && (
        <div className="text-xs font-medium text-muted-foreground">{viz.title}</div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {viz.blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>
    </div>
  );
}
function Block({ block }: { block: VizBlock }) {
  const wide = block.kind === "table" || block.kind === "stacked" || block.kind === "heatmap";
  return (
    <section
      className={cnPanel(wide)}
      aria-label={block.title ?? block.kind}
    >
      {block.title && <PanelTitle>{block.title}</PanelTitle>}
      {block.kind === "stats" && <Stats stats={block.stats} />}
      {block.kind === "bar" && <Bars data={block.data} unit={block.unit} />}
      {block.kind === "stacked" && (
        <Stacked series={block.series} data={block.data} unit={block.unit} />
      )}
      {block.kind === "donut" && <Donut data={block.data} unit={block.unit} />}
      {block.kind === "treemap" && <Treemap data={block.data} unit={block.unit} />}
      {block.kind === "heatmap" && (
        <Heatmap rows={block.rows} columns={block.columns} values={block.values} legend={block.legend} />
      )}
      {block.kind === "table" && <Table columns={block.columns} rows={block.rows} />}
    </section>
  );
}

function cnPanel(wide: boolean): string {
  return [
    "rounded-lg border border-border bg-card p-3",
    wide ? "md:col-span-2" : "",
  ].join(" ");
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</div>;
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: it.color }} />
          <span className="max-w-[140px] truncate" title={it.label}>{it.label}</span>
        </span>
      ))}
    </div>
  );
}

function Stats({ stats }: { stats: { label: string; value: number; unit?: string; tone?: VizTone }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {stats.map((s, i) => (
        <div key={i} className="rounded-md border border-border bg-secondary/30 px-3 py-2">
          <div className="text-lg font-semibold tabular-nums" style={{ color: toneColor(s.tone, i) }}>
            {formatNum(s.value)}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={s.label}>
            {s.label}
            {s.unit ? ` (${s.unit})` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

function Bars({ data, unit }: { data: VizDatum[]; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  return (
    <div className="space-y-1.5">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-[11px] text-muted-foreground" title={d.label}>
            {d.label}
          </span>
          <span className="h-3 min-w-0 flex-1 rounded-sm bg-secondary">
            <span
              className="block h-3 rounded-sm"
              style={{ width: `${(Math.abs(d.value) / max) * 100}%`, backgroundColor: toneColor(d.tone, i) }}
            />
          </span>
          <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-foreground">
            {formatNum(d.value)}
          </span>
        </div>
      ))}
      {unit && <div className="text-right text-[10px] text-muted-foreground">{unit}</div>}
    </div>
  );
}

function Stacked({
  series,
  data,
  unit,
}: {
  series: string[];
  data: { label: string; values: number[] }[];
  unit?: string;
}) {
  const rows = data.slice(0, MAX_VISIBLE_ROWS);
  const totals = rows.map((r) => r.values.reduce((n, v) => n + Math.abs(v), 0));
  const max = Math.max(1, ...totals);
  const colors = series.map((_, i) => toneColor(undefined, i));
  return (
    <div>
      <div className="space-y-1.5">
        {rows.map((r, ri) => (
          <div key={ri} className="flex items-center gap-2">
            <span className="w-28 shrink-0 truncate text-[11px] text-muted-foreground" title={r.label}>
              {r.label}
            </span>
            <span className="flex h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-secondary">
              {r.values.map((v, vi) => (
                <span
                  key={vi}
                  className="h-3"
                  style={{ width: `${(Math.abs(v) / max) * 100}%`, backgroundColor: colors[vi % colors.length] }}
                  title={`${series[vi] ?? ""}: ${formatNum(v)}`}
                />
              ))}
            </span>
            <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-foreground">
              {formatNum(totals[ri])}
            </span>
          </div>
        ))}
      </div>
      <Legend items={series.map((s, i) => ({ label: s, color: colors[i % colors.length] }))} />
      {unit && <div className="mt-1 text-right text-[10px] text-muted-foreground">{unit}</div>}
    </div>
  );
}

function Donut({ data, unit }: { data: VizDatum[]; unit?: string }) {
  const total = data.reduce((n, d) => n + Math.abs(d.value), 0);
  const r = 42;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const slices = data.map((d, i) => {
    const frac = total > 0 ? Math.abs(d.value) / total : 0;
    const seg = { color: toneColor(d.tone, i), dash: frac * circ, offset };
    offset += frac * circ;
    return seg;
  });
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 120 120" className="h-28 w-28 shrink-0 -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="18" className="stroke-secondary" />
        {slices.map((s, i) => (
          <circle
            key={i}
            cx="60"
            cy="60"
            r={r}
            fill="none"
            strokeWidth="18"
            stroke={s.color}
            strokeDasharray={`${s.dash} ${circ - s.dash}`}
            strokeDashoffset={-s.offset}
          />
        ))}
      </svg>
      <div className="min-w-0 flex-1">
        <Legend
          items={data.map((d, i) => ({
            label: `${d.label} ${formatNum(d.value)}${unit ? ` ${unit}` : ""}`,
            color: toneColor(d.tone, i),
          }))}
        />
      </div>
    </div>
  );
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  index: number;
}

// Binary partition treemap: recursively split each region along its longer axis
// so rectangles keep a reasonable aspect ratio.
function squarify(items: number[], x: number, y: number, w: number, h: number, out: Rect[], base = 0): void {
  if (items.length === 0) return;
  if (items.length === 1) {
    out.push({ x, y, w, h, index: base });
    return;
  }
  const total = items.reduce((a, b) => a + b, 0) || 1;
  let bestSplit = 1;
  let bestDiff = Infinity;
  let prefix = 0;
  for (let i = 0; i < items.length - 1; i++) {
    prefix += items[i];
    const diff = Math.abs(prefix - (total - prefix));
    if (diff < bestDiff) {
      bestDiff = diff;
      bestSplit = i + 1;
    }
  }
  const sumA = items.slice(0, bestSplit).reduce((a, b) => a + b, 0);
  const ratio = sumA / total;
  if (w >= h) {
    const wA = w * ratio;
    squarify(items.slice(0, bestSplit), x, y, wA, h, out, base);
    squarify(items.slice(bestSplit), x + wA, y, w - wA, h, out, base + bestSplit);
  } else {
    const hA = h * ratio;
    squarify(items.slice(0, bestSplit), x, y, w, hA, out, base);
    squarify(items.slice(bestSplit), x, y + hA, w, h - hA, out, base + bestSplit);
  }
}

function Treemap({ data, unit }: { data: VizDatum[]; unit?: string }) {
  const W = 320;
  const H = 180;
  const rects: Rect[] = [];
  squarify(data.map((d) => Math.abs(d.value) || 0.0001), 0, 0, W, H, rects);
  const total = data.reduce((n, d) => n + Math.abs(d.value), 0);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full">
        {rects.map((r) => {
          const d = data[r.index];
          const pct = total > 0 ? Math.round((Math.abs(d.value) / total) * 100) : 0;
          const showText = r.w > 54 && r.h > 26;
          return (
            <g key={r.index}>
              <rect
                x={r.x + 1}
                y={r.y + 1}
                width={Math.max(0, r.w - 2)}
                height={Math.max(0, r.h - 2)}
                rx={3}
                fill={toneColor(d.tone, r.index)}
              >
                <title>{`${d.label}: ${formatNum(d.value)}${unit ? ` ${unit}` : ""} (${pct}%)`}</title>
              </rect>
              {showText && (
                <text
                  x={r.x + 7}
                  y={r.y + 17}
                  fill="#fff"
                  stroke="rgba(0,0,0,0.35)"
                  strokeWidth={2.5}
                  paintOrder="stroke"
                  className="text-[9px]"
                  style={{ fontWeight: 600 }}
                >
                  {d.label.length > Math.floor(r.w / 6) ? `${d.label.slice(0, Math.max(3, Math.floor(r.w / 6)))}...` : d.label}
                </text>
              )}
              {showText && r.h > 40 && (
                <text
                  x={r.x + 7}
                  y={r.y + 30}
                  fill="#fff"
                  stroke="rgba(0,0,0,0.35)"
                  strokeWidth={2.5}
                  paintOrder="stroke"
                  className="text-[9px]"
                >
                  {formatNum(d.value)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {unit && <div className="text-right text-[10px] text-muted-foreground">{unit}</div>}
    </div>
  );
}

function Heatmap({
  rows,
  columns,
  values,
  legend,
}: {
  rows: string[];
  columns: string[];
  values: number[][];
  legend?: [string, string];
}) {
  const max = Math.max(1, ...values.flat());
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5">
        <thead>
          <tr>
            <th />
            {columns.map((c, i) => (
              <th key={i} className="pb-1 text-[10px] font-normal text-muted-foreground" title={c}>
                <span className="block max-w-[64px] truncate">{c}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              <th className="max-w-[120px] truncate pr-2 text-right text-[10px] font-normal text-muted-foreground" title={r}>
                {r}
              </th>
              {columns.map((_, ci) => {
                const v = values[ri]?.[ci] ?? 0;
                const alpha = v <= 0 ? 0.06 : 0.18 + 0.72 * (v / max);
                return (
                  <td
                    key={ci}
                    className="h-6 w-6 rounded-sm text-center text-[10px] tabular-nums text-foreground"
                    style={{ backgroundColor: `hsl(var(--destructive) / ${alpha})` }}
                    title={`${r} / ${columns[ci]}: ${v}`}
                  >
                    {v > 0 ? v : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {legend && (
        <div className="mt-1.5 text-[10px] text-muted-foreground">
          {legend[0]} &rarr; {legend[1]}
        </div>
      )}
    </div>
  );
}

function Table({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            {columns.map((c, i) => (
              <th key={i} className="px-2 py-1.5 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border/60 last:border-0">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={
                    ci === 0
                      ? "max-w-[220px] truncate px-2 py-1 font-medium text-foreground"
                      : "whitespace-nowrap px-2 py-1 tabular-nums text-muted-foreground"
                  }
                  title={cell}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
