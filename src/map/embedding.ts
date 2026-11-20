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
  /** Fields from map cassette v0.2; empty or zero from an older cassette. */
  started_at: string;
  turn_count: number;
  cost_usd: number;
  tool_error_count: number;
  prompt: string;
  /** HDBSCAN cluster id, -1 for points in no cluster. */
  cluster: number;
}

export interface Cluster {
  id: number;
  label: string;
  terms: string[];
  size: number;
  x: number;
  y: number;
}

export interface MapPoints {
  computed_at: string;
  model: string;
  method: string;
  session_count: number;
  points: MapPoint[];
  clusters: Cluster[];
}

export const COLOUR_BY = {
  repo: "repo",
  cluster: "topic cluster",
  harness: "harness",
  hour: "time of day",
  recency: "last active",
  cost: "cost",
  errors: "tool errors",
} as const;
export type ColourBy = keyof typeof COLOUR_BY;

export interface Highlight {
  /** Keys of the colour dimension to keep lit; every key when absent. */
  only?: ReadonlySet<string>;
  text: string;
  /** Sessions found by a semantic search; every session when absent. */
  sessions?: ReadonlySet<string>;
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

function optionalNumber(record: Record<string, unknown>, key: string, where: string): number {
  const v = record[key];
  if (v === undefined || v === null) return 0;
  return finite({ [key]: typeof v === "string" ? Number(v) : v }, key, where);
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
      started_at: text(raw, "started_at", where),
      turn_count: optionalNumber(raw, "turn_count", where),
      cost_usd: optionalNumber(raw, "cost_usd", where),
      tool_error_count: optionalNumber(raw, "tool_error_count", where),
      prompt: text(raw, "prompt", where),
      cluster: raw.cluster === undefined || raw.cluster === null ? -1 : finite(raw, "cluster", where),
    };
  });
  const clusters = (Array.isArray(body.clusters) ? body.clusters : []).map((raw, i): Cluster => {
    const where = `clusters[${i}]`;
    if (!isRecord(raw)) throw new InvalidMapPoints(`${where} is not an object`);
    return {
      id: finite(raw, "id", where),
      label: text(raw, "label", where),
      terms: Array.isArray(raw.terms) ? raw.terms.filter((t): t is string => typeof t === "string") : [],
      size: optionalNumber(raw, "size", where),
      x: finite(raw, "x", where),
      y: finite(raw, "y", where),
    };
  });
  return {
    computed_at: text(body, "computed_at", "body"),
    model: text(body, "model", "body"),
    method: text(body, "method", "body"),
    session_count: body.session_count === undefined ? points.length : finite(body, "session_count", "body"),
    points,
    clusters,
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

export const ID_LIKE = /^[0-9a-f-]{8,}$/i;
/** The session's title, or "" when the only name it has is an id fragment. */
export const titleOf = (p: MapPoint) => (p.title && !ID_LIKE.test(p.title) ? p.title : p.prompt.trim());

const HOUR_BUCKETS = ["00–03", "03–06", "06–09", "09–12", "12–15", "15–18", "18–21", "21–24"];
// Night blue through morning teal, midday yellow and evening orange, back to violet.
const HOUR_COLOURS = ["#3b4f9a", "#4a6fb5", "#3fa3a0", "#8cc265", "#edc948", "#f28e2b", "#d1615d", "#8e5fa8"];
const RECENCY = ["today", "this week", "this month", "older"];
const RECENCY_COLOURS = ["#f6d55c", "#f2a33a", "#c8603a", "#6b4a3a"];
const COST = ["under $0.10", "$0.10–$1", "$1–$10", "$10 and up"];
const COST_COLOURS = ["#3c5a7a", "#4e8ac4", "#7fb8f0", "#d4ecff"];
const ERRORS = ["no tool errors", "tool errors"];
const ERROR_COLOURS = ["#4a6a5a", "#e15759"];
const NO_CLUSTER = "(no cluster)";

/** Fixed bucket order and colours for the ordered dimensions. */
const ORDERED: Partial<Record<ColourBy, { keys: string[]; colours: string[] }>> = {
  hour: { keys: HOUR_BUCKETS, colours: HOUR_COLOURS },
  recency: { keys: RECENCY, colours: RECENCY_COLOURS },
  cost: { keys: COST, colours: COST_COLOURS },
  errors: { keys: ERRORS, colours: ERROR_COLOURS },
};

const DAY = 86_400_000;

export interface KeyContext {
  now: number;
  clusterLabels: ReadonlyMap<number, string>;
}

export function keyOf(p: MapPoint, by: ColourBy, ctx: KeyContext = { now: Date.now(), clusterLabels: new Map() }): string {
  switch (by) {
    case "harness":
      return harnessOf(p);
    case "repo":
      return repoOf(p.cwd);
    case "cluster":
      return p.cluster < 0 ? NO_CLUSTER : ctx.clusterLabels.get(p.cluster) ?? `cluster ${p.cluster}`;
    case "hour": {
      const t = Date.parse(p.started_at || p.last_seen_at);
      return Number.isFinite(t) ? HOUR_BUCKETS[Math.floor(new Date(t).getHours() / 3)]! : "unknown";
    }
    case "recency": {
      const age = ctx.now - Date.parse(p.last_seen_at);
      return age < DAY ? RECENCY[0]! : age < 7 * DAY ? RECENCY[1]! : age < 30 * DAY ? RECENCY[2]! : RECENCY[3]!;
    }
    case "cost":
      return p.cost_usd < 0.1 ? COST[0]! : p.cost_usd < 1 ? COST[1]! : p.cost_usd < 10 ? COST[2]! : COST[3]!;
    case "errors":
      return p.tool_error_count > 0 ? ERRORS[1]! : ERRORS[0]!;
  }
}

/** Dimensions the loaded points can colour by; the newer ones need map cassette v0.2 fields. */
export function availableColourBy(data: MapPoints): ColourBy[] {
  const has = (f: (p: MapPoint) => boolean) => data.points.some(f);
  return (Object.keys(COLOUR_BY) as ColourBy[]).filter((by) =>
    by === "cluster" ? data.clusters.length > 0
      : by === "cost" ? has((p) => p.cost_usd > 0)
      : by === "errors" ? has((p) => p.turn_count > 0)
      : by === "hour" ? has((p) => p.started_at !== "") || has((p) => p.last_seen_at !== "")
      : true,
  );
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

/**
 * Harnesses keep their fixed colours and ordered dimensions their own scales;
 * repos and clusters get distinct colours by size, and the long tail shares grey.
 */
export function palette(points: MapPoint[], by: ColourBy, ctx?: KeyContext): Palette {
  const counts = countBy(points, (p) => keyOf(p, by, ctx));
  if (by === "harness") return { colourOf: colour, named: counts, other: [] };
  const ordered = ORDERED[by];
  if (ordered) {
    const n = new Map(counts);
    const colours = new Map(ordered.keys.map((k, i) => [k, ordered.colours[i]!]));
    return {
      colourOf: (key) => colours.get(key) ?? OTHER_COLOUR,
      named: ordered.keys.filter((k) => n.has(k)).map((k) => [k, n.get(k)!]),
      other: counts.filter(([k]) => !colours.has(k)),
    };
  }
  const named = counts.filter(([key]) => !key.startsWith("(")).slice(0, RANKED.length);
  const colours = new Map(named.map(([key], i) => [key, RANKED[i]!]));
  return {
    colourOf: (key) => colours.get(key) ?? OTHER_COLOUR,
    named,
    other: counts.filter(([key]) => !colours.has(key)),
  };
}

export function isLit(p: MapPoint, by: ColourBy, highlight: Highlight, ctx?: KeyContext): boolean {
  if (highlight.only && !highlight.only.has(keyOf(p, by, ctx))) return false;
  if (highlight.sessions && !highlight.sessions.has(p.session_id)) return false;
  const needle = highlight.text.trim().toLowerCase();
  return !needle || [p.title, p.prompt, p.cwd].some((v) => v.toLowerCase().includes(needle));
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
