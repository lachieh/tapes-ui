import { basename } from "../format";

export interface MapPoint {
  session_id: string;
  x: number;
  y: number;
  z: number;
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

export type ColourBy = "harness" | "project";

export const TEMP_WORKSPACE_PROJECT = "project";
export const SCENE_RADIUS = 400;

export interface PointFilter {
  harnesses?: ReadonlySet<string>;
  text: string;
  includeTempWorkspaces: boolean;
}

export interface EmbeddingNode {
  id: string;
  x: number;
  y: number;
  z: number;
  val: number;
  colourKey: string;
  point: MapPoint;
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
      z: finite(raw, "z", where),
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
export const projectOf = (p: MapPoint) => basename(p.cwd) || "(no project)";
export const isTempWorkspace = (p: MapPoint) => basename(p.cwd) === TEMP_WORKSPACE_PROJECT;

export function colourKey(p: MapPoint, by: ColourBy): string {
  return by === "harness" ? harnessOf(p) : projectOf(p);
}

export function filterPoints(points: MapPoint[], filter: PointFilter): MapPoint[] {
  const needle = filter.text.trim().toLowerCase();
  return points.filter((p) =>
    (filter.includeTempWorkspaces || !isTempWorkspace(p)) &&
    (!filter.harnesses || filter.harnesses.has(harnessOf(p))) &&
    (!needle || projectOf(p).toLowerCase().includes(needle) || p.title.toLowerCase().includes(needle)),
  );
}

export function nodeVal(spanCount: number): number {
  return 1 + Math.round(Math.log2(1 + Math.max(0, spanCount)) * 2) / 2;
}

export function toNodes(points: MapPoint[], by: ColourBy): EmbeddingNode[] {
  return points.map((point) => ({
    id: point.session_id,
    x: point.x * SCENE_RADIUS,
    y: point.y * SCENE_RADIUS,
    z: point.z * SCENE_RADIUS,
    val: nodeVal(point.span_count),
    colourKey: colourKey(point, by),
    point,
  }));
}

export function countBy(points: MapPoint[], key: (p: MapPoint) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const p of points) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
