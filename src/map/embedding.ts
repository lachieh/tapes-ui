import { basename, colour } from "../format";

export interface MapPoint {
  session_id: string;
  x: number;
  y: number;
  span_count: number;
  harness_id: string;
  cwd: string;
  title: string;
  last_seen_at: string;
}

export interface MapPoints {
  computed_at: string;
  model: string;
  method: string;
  session_count: number;
  points: MapPoint[];
}

export type ColourBy = "harness" | "repo";

export interface Highlight {
  /** Keys of the colour dimension to keep lit; every key when absent. */
  only?: ReadonlySet<string>;
  text: string;
}

class InvalidMapPoints extends Error {
  constructor(what: string) {
    super(`Invalid map points response: ${what}`);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function finite(record: Record<string, unknown>, key: string, where: string): number {
  const v = record[key];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new InvalidMapPoints(`${where}.${key} is not a finite number`);
  return v;
}

function text(record: Record<string, unknown>, key: string, where: string): string {
  const v = record[key];
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new InvalidMapPoints(`${where}.${key} is not a string`);
  return v;
}

export function parseMapPoints(body: unknown): MapPoints {
  if (!isRecord(body)) throw new InvalidMapPoints("body is not an object");
  if (!Array.isArray(body.points)) throw new InvalidMapPoints("points is not an array");
  const points = body.points.map((raw, i): MapPoint => {
    const where = `points[${i}]`;
    if (!isRecord(raw)) throw new InvalidMapPoints(`${where} is not an object`);
    const session_id = text(raw, "session_id", where);
    if (!session_id) throw new InvalidMapPoints(`${where}.session_id is missing`);
    return {
      session_id,
      x: finite(raw, "x", where),
      y: finite(raw, "y", where),
      span_count: raw.span_count === undefined ? 0 : finite(raw, "span_count", where),
      harness_id: text(raw, "harness_id", where),
      cwd: text(raw, "cwd", where),
      title: text(raw, "title", where),
      last_seen_at: text(raw, "last_seen_at", where),
    };
  });
  return {
    computed_at: text(body, "computed_at", "body"),
    model: text(body, "model", "body"),
    method: text(body, "method", "body"),
    session_count: body.session_count === undefined ? points.length : finite(body, "session_count", "body"),
    points,
  };
}

export const harnessOf = (p: MapPoint) => p.harness_id || "unknown";

const HOME = /^(?:\/Users|\/home|\/Volumes\/[^/]+\/Home)\/[^/]+$/;
const TEMP = /^(?:\/tmp|\/private\/tmp|\/private\/var\/folders|\/var\/folders)(?:\/|$)/;
// Agent worktree roots put the repository name after the root; .codex adds a short id first.
const WORKTREE_ROOT = /(?:^|\/)(?:Projects\/\.worktrees|\.t3\/worktrees|\.herdr\/worktrees|\.worktrees)\/([^/]+)/;
const CODEX_WORKTREE = /\/\.codex\/worktrees\/[^/]+\/([^/]+)/;
const NESTED_WORKTREE = /\/([^/.][^/]*)\/\.worktrees\//;

/** The repository a session ran in, with agent worktree paths folded into their repository. */
export function repoOf(cwd: string): string {
  const path = cwd.replace(/\/+$/, "");
  if (!path) return "(no directory)";
  if (TEMP.test(path)) return "(temp)";
  if (HOME.test(path)) return "(home)";
  if (/\/\.t3\/scratch(?:\/|$)/.test(path)) return "(scratch)";
  const codex = CODEX_WORKTREE.exec(path);
  if (codex) return codex[1]!;
  const nested = NESTED_WORKTREE.exec(path);
  if (nested && !/^(?:Projects|SSD)$/.test(nested[1]!)) return nested[1]!;
  const worktree = WORKTREE_ROOT.exec(path);
  if (worktree) return worktree[1]!;
  return basename(path);
}

/** Sessions that carry almost no content, or ran in a throwaway directory, crowd the edges of the map. */
export const TINY_SESSION_SPANS = 2;
export const isBackground = (p: MapPoint) => p.span_count <= TINY_SESSION_SPANS || repoOf(p.cwd) === "(temp)";

const ID_LIKE = /^[0-9a-f-]{8,}$/i;
/** The session's title, or "" when the only name it has is an id fragment. */
export const titleOf = (p: MapPoint) => (p.title && !ID_LIKE.test(p.title) ? p.title : "");

export function keyOf(p: MapPoint, by: ColourBy): string {
  return by === "harness" ? harnessOf(p) : repoOf(p.cwd);
}

export function countBy(points: MapPoint[], key: (p: MapPoint) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const p of points) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export const OTHER_COLOUR = "#4a515b";
const RANKED = ["#4e9af1", "#f28e2b", "#59a14f", "#e15759", "#b07aa1", "#76b7b2", "#edc948", "#ff9da7"];

export interface Palette {
  colourOf: (key: string) => string;
  /** Keys with their own colour, largest first. */
  named: [string, number][];
  /** Keys sharing the grey "other" colour. */
  other: [string, number][];
}

/** Harnesses keep their fixed colours; repositories get distinct colours by size, and the long tail shares grey. */
export function palette(points: MapPoint[], by: ColourBy): Palette {
  const counts = countBy(points, (p) => keyOf(p, by));
  if (by === "harness") return { colourOf: colour, named: counts, other: [] };
  const named = counts.filter(([key]) => !key.startsWith("(")).slice(0, RANKED.length);
  const colours = new Map(named.map(([key], i) => [key, RANKED[i]!]));
  return {
    colourOf: (key) => colours.get(key) ?? OTHER_COLOUR,
    named,
    other: counts.filter(([key]) => !colours.has(key)),
  };
}

export function isLit(p: MapPoint, by: ColourBy, highlight: Highlight): boolean {
  if (highlight.only && !highlight.only.has(keyOf(p, by))) return false;
  const needle = highlight.text.trim().toLowerCase();
  return !needle || p.title.toLowerCase().includes(needle) || p.cwd.toLowerCase().includes(needle);
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function quantile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** The box holding the middle of the points, so a few far outliers don't shrink everything else. */
export function robustBounds(points: { x: number; y: number }[], tail = 0.02): Bounds | undefined {
  if (points.length === 0) return undefined;
  const xs = points.map((p) => p.x).sort((a, b) => a - b);
  const ys = points.map((p) => p.y).sort((a, b) => a - b);
  const t = points.length < 50 ? 0 : tail;
  return { minX: quantile(xs, t), maxX: quantile(xs, 1 - t), minY: quantile(ys, t), maxY: quantile(ys, 1 - t) };
}

/** Screen radius in CSS pixels at zoom 1, growing slowly with the session's size. */
export function pointRadius(spanCount: number): number {
  return 1.6 + Math.min(4, Math.sqrt(Math.max(0, spanCount)) / 4);
}
