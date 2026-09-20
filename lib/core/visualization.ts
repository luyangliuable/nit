import type {
  ChangeVisualization,
  VizBlock,
  VizDatum,
  VizStackRow,
  VizStat,
  VizTone,
} from "@/lib/shared/types";

// Structured change visualization: validate/normalize the JSON a model returns
// and derive a deterministic fallback from a unified diff. Everything here is
// pure so it can be unit tested and reused on the server and the client.

const MAX_BLOCKS = 12;
const MAX_ITEMS = 24;
const MAX_COLS = 8;
const MAX_ROWS = 40;
const MAX_LABEL = 80;

const TONES: readonly VizTone[] = ["neutral", "add", "del", "warning", "critical"];

function tone(v: unknown): VizTone | undefined {
  return typeof v === "string" && (TONES as readonly string[]).includes(v)
    ? (v as VizTone)
    : undefined;
}

export function vizLabel(v: unknown, max = MAX_LABEL): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().replace(/\s+/g, " ");
  if (s === "") return undefined;
  return s.length > max ? `${s.slice(0, max - 1)}...` : s;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
function statOf(v: unknown): VizStat | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const label = vizLabel(o.label);
  const value = num(o.value);
  if (!label || value === undefined) return null;
  return { label, value, unit: vizLabel(o.unit, 12), tone: tone(o.tone) };
}

function datumOf(v: unknown): VizDatum | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const label = vizLabel(o.label);
  const value = num(o.value);
  if (!label || value === undefined) return null;
  return { label, value, tone: tone(o.tone) };
}

function stackRowOf(v: unknown, width: number): VizStackRow | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const label = vizLabel(o.label);
  if (!label || !Array.isArray(o.values)) return null;
  const values = o.values.map((n) => num(n)).map((n) => n ?? 0);
  if (values.length === 0) return null;
  return { label, values: values.slice(0, width), tone: tone(o.tone) };
}

function dataList(v: unknown): VizDatum[] {
  if (!Array.isArray(v)) return [];
  return v
    .map(datumOf)
    .filter((d): d is VizDatum => d !== null)
    .slice(0, MAX_ITEMS);
}

function blockOf(v: unknown): VizBlock | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const title = vizLabel(o.title, 60);
  const base = title ? { title } : {};
  const unit = vizLabel(o.unit, 12);

  switch (o.kind) {
    case "stats": {
      if (!Array.isArray(o.stats)) return null;
      const stats = o.stats
        .map(statOf)
        .filter((s): s is VizStat => s !== null)
        .slice(0, MAX_COLS);
      return stats.length > 0 ? { ...base, kind: "stats", stats } : null;
    }
    case "bar":
    case "donut":
    case "treemap": {
      const data = dataList(o.data);
      return data.length > 0 ? { ...base, kind: o.kind, unit, data } : null;
    }
    case "stacked": {
      if (!Array.isArray(o.series) || !Array.isArray(o.data)) return null;
      const series = o.series
        .map((s) => vizLabel(s, 24))
        .filter((s): s is string => s !== undefined)
        .slice(0, MAX_COLS);
      if (series.length === 0) return null;
      const data = o.data
        .map((r) => stackRowOf(r, series.length))
        .filter((r): r is VizStackRow => r !== null)
        .slice(0, MAX_ITEMS);
      return data.length > 0 ? { ...base, kind: "stacked", unit, series, data } : null;
    }
    case "heatmap": {
      if (!Array.isArray(o.rows) || !Array.isArray(o.columns) || !Array.isArray(o.values)) return null;
      const rows = o.rows.map((r) => vizLabel(r, 32)).filter((r): r is string => r !== undefined).slice(0, MAX_ROWS);
      const columns = o.columns.map((c) => vizLabel(c, 24)).filter((c): c is string => c !== undefined).slice(0, MAX_COLS);
      if (rows.length === 0 || columns.length === 0) return null;
      const values = (o.values as unknown[]).slice(0, MAX_ROWS).map((row) => {
        const arr = Array.isArray(row) ? row : [];
        return columns.map((_, i) => num(arr[i]) ?? 0);
      });
      const legend = Array.isArray(o.legend) && o.legend.length === 2
        ? (o.legend.map((l) => vizLabel(l, 24)) as [string, string])
        : undefined;
      return { ...base, kind: "heatmap", rows, columns, values, legend };
    }
    case "table": {
      if (!Array.isArray(o.columns) || !Array.isArray(o.rows)) return null;
      const columns = o.columns.map((c) => vizLabel(c, 32)).filter((c): c is string => c !== undefined).slice(0, MAX_COLS);
      if (columns.length === 0) return null;
      const rows = (o.rows as unknown[]).slice(0, MAX_ROWS).map((row) => {
        const arr = Array.isArray(row) ? row : [];
        return columns.map((_, i) => vizLabel(arr[i], 48) ?? "");
      });
      return rows.length > 0 ? { ...base, kind: "table", columns, rows } : null;
    }
    default:
      return null;
  }
}

// Extract and validate a visualization from raw model output. Tolerates code
// fences and surrounding prose. Returns null when nothing usable is found.
export function parseVisualization(text: string): ChangeVisualization | null {
  const cleaned = text.replace(/```[a-zA-Z]*/g, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const arrStart = cleaned.indexOf("[");
  let slice = "";
  if (start >= 0 && (arrStart < 0 || start < arrStart)) {
    const end = cleaned.lastIndexOf("}");
    if (end <= start) return null;
    slice = cleaned.slice(start, end + 1);
  } else if (arrStart >= 0) {
    const end = cleaned.lastIndexOf("]");
    if (end <= arrStart) return null;
    slice = cleaned.slice(arrStart, end + 1);
  } else {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return null;
  }
  return normalizeVisualization(parsed);
}

export function normalizeVisualization(v: unknown): ChangeVisualization | null {
  const rawBlocks = Array.isArray(v)
    ? v
    : typeof v === "object" && v !== null && Array.isArray((v as { blocks?: unknown }).blocks)
      ? ((v as { blocks: unknown[] }).blocks)
      : null;
  if (!rawBlocks) return null;
  const blocks = rawBlocks
    .map(blockOf)
    .filter((b): b is VizBlock => b !== null)
    .slice(0, MAX_BLOCKS);
  if (blocks.length === 0) return null;
  const title =
    typeof v === "object" && v !== null ? vizLabel((v as { title?: unknown }).title, 60) : undefined;
  return title ? { title, blocks } : { blocks };
}

export interface FileStat {
  path: string;
  added: number;
  removed: number;
}

// Count added/removed lines per file from a unified diff. Purely textual, so it
// works for the filtered/capped diff the review already fetched.
export function analyzeDiff(diff: string): FileStat[] {
  const files: FileStat[] = [];
  let current: FileStat | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.split(/\s+/)[1] ?? "";
      const path = p.replace(/^b\//, "").replace(/^a\//, "");
      current = path === "/dev/null" ? null : { path, added: 0, removed: 0 };
      if (current) files.push(current);
      continue;
    }
    if (line.startsWith("--- ")) continue;
    if (!current) continue;
    if (line.startsWith("+")) current.added++;
    else if (line.startsWith("-")) current.removed++;
  }
  return files;
}

export function diffCategory(path: string): string {
  if (/(^|\/)(test|tests|__tests__|spec)(\/|$)|\.(test|spec)\.[tj]sx?$/i.test(path)) return "Tests";
  if (/\.(md|mdx|txt|rst)$/i.test(path)) return "Docs";
  if (/(^|\/)(package\.json|tsconfig.*\.json|\.github\/|.*\.config\.[tj]s|\.env|Dockerfile|Makefile)/i.test(path)) return "Config";
  if (/\.(css|scss|sass|less)$/i.test(path)) return "Styles";
  if (/\.(sql|prisma|migration)/i.test(path)) return "Data";
  return "Source";
}

// A real, diff-derived visualization used when the model output is unusable.
// Guarantees the reviewer still sees diagrams and tables rather than nothing.
export function deterministicVisualization(diff: string, title?: string): ChangeVisualization {
  const files = analyzeDiff(diff);
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  const churn = (f: FileStat) => f.added + f.removed;
  const top = [...files].sort((a, b) => churn(b) - churn(a)).slice(0, 12);
  const short = (p: string) => p.replace(/^.*\//, "");

  const areas = new Map<string, number>();
  for (const f of files) areas.set(diffCategory(f.path), (areas.get(diffCategory(f.path)) ?? 0) + churn(f));

  const blocks: VizBlock[] = [
    {
      kind: "stats",
      stats: [
        { label: "Files", value: files.length, tone: "neutral" },
        { label: "Added", value: added, unit: "lines", tone: "add" },
        { label: "Removed", value: removed, unit: "lines", tone: "del" },
      ],
    },
  ];

  if (top.length > 0) {
    blocks.push({
      kind: "stacked",
      title: "Added vs removed per file",
      unit: "lines",
      series: ["Added", "Removed"],
      data: top.map((f) => ({ label: short(f.path), values: [f.added, f.removed] })),
    });
    blocks.push({
      kind: "bar",
      title: "Churn by file",
      unit: "lines",
      data: top.map((f) => ({ label: short(f.path), value: churn(f), tone: f.removed > f.added ? "del" : "add" })),
    });
    blocks.push({
      kind: "table",
      title: "File impact",
      columns: ["File", "Area", "Added", "Removed"],
      rows: top.map((f) => [short(f.path), diffCategory(f.path), String(f.added), String(f.removed)]),
    });
  }

  if (areas.size > 0) {
    blocks.push({
      kind: "donut",
      title: "Churn by area",
      unit: "lines",
      data: [...areas.entries()].map(([label, value]) => ({ label, value })),
    });
  }

  return title ? { title, blocks } : { blocks };
}
