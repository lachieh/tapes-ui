import { ID_LIKE, repoOf } from "../map/embedding";

export interface TimelineTurn {
  trace_id: string;
  started: number;
  ended: number;
  status: string;
  synthetic: boolean;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  /** Absent when the cassette ran out of time counting this turn's spans. */
  span_count?: number;
  error_span_count?: number;
  prompt: string;
}

export interface TimelineSession {
  session_id: string;
  parent_session_id: string;
  harness_id: string;
  cwd: string;
  title: string;
  started: number;
  last_seen: number;
  ended?: number;
  status: string;
  turn_count: number;
  cost_usd: number;
  tool_error_count: number;
  turns: TimelineTurn[];
}

export interface Timeline {
  since: number;
  until: number;
  truncated: boolean;
  sessions: TimelineSession[];
}

export interface TurnSpan {
  span_id: string;
  parent_span_id: string;
  kind: string;
  name: string;
  status: string;
  call_kind: string;
  thread_id: string;
  model: string;
  started: number;
  ended: number;
  input_tokens: number;
  output_tokens: number;
}

export interface TurnSpans {
  trace_id: string;
  session_id: string;
  spans: TurnSpan[];
}

class InvalidResponse extends Error {
  constructor(what: string) {
    super(`Invalid timeline response: ${what}`);
  }
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

function str(r: Rec, key: string, where: string): string {
  const v = r[key];
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new InvalidResponse(`${where}.${key} is not a string`);
  return v;
}

function num(r: Rec, key: string, where: string): number {
  const v = r[key];
  if (v === undefined || v === null) return 0;
  // Postgres numerics may arrive as strings.
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new InvalidResponse(`${where}.${key} is not a number`);
  return n;
}

function time(r: Rec, key: string, where: string): number {
  const t = Date.parse(str(r, key, where));
  if (!Number.isFinite(t)) throw new InvalidResponse(`${where}.${key} is not a timestamp`);
  return t;
}

function optionalTime(r: Rec, key: string, where: string): number | undefined {
  return r[key] === undefined || r[key] === null || r[key] === "" ? undefined : time(r, key, where);
}

function list(r: Rec, key: string, where: string): Rec[] {
  const v = r[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new InvalidResponse(`${where}.${key} is not an array`);
  return v.map((item, i) => {
    if (!isRecord(item)) throw new InvalidResponse(`${where}.${key}[${i}] is not an object`);
    return item;
  });
}

const NS_PER_MS = 1e6;

export function parseTimeline(body: unknown): Timeline {
  if (!isRecord(body)) throw new InvalidResponse("body is not an object");
  if (!Array.isArray(body.sessions)) throw new InvalidResponse("sessions is not an array");
  return {
    since: time(body, "since", "body"),
    until: time(body, "until", "body"),
    truncated: body.truncated === true,
    sessions: list(body, "sessions", "body").map((s, i): TimelineSession => {
      const where = `sessions[${i}]`;
      const started = time(s, "started_at", where);
      return {
        session_id: str(s, "session_id", where),
        parent_session_id: str(s, "parent_session_id", where),
        harness_id: str(s, "harness_id", where) || "unknown",
        cwd: str(s, "cwd", where),
        title: str(s, "title", where),
        started,
        last_seen: Math.max(started, time(s, "last_seen_at", where)),
        ended: optionalTime(s, "ended_at", where),
        status: str(s, "status", where),
        turn_count: num(s, "turn_count", where),
        cost_usd: num(s, "cost_usd", where),
        tool_error_count: num(s, "tool_error_count", where),
        turns: list(s, "turns", where).map((t, j): TimelineTurn => {
          const at = `${where}.turns[${j}]`;
          const tStart = time(t, "started_at", at);
          const tEnd = optionalTime(t, "ended_at", at) ?? tStart + num(t, "duration_ns", at) / NS_PER_MS;
          return {
            trace_id: str(t, "trace_id", at),
            started: tStart,
            ended: Math.max(tStart, tEnd),
            status: str(t, "status", at),
            synthetic: t.synthetic === true,
            cost_usd: num(t, "cost_usd", at),
            input_tokens: num(t, "input_tokens", at),
            output_tokens: num(t, "output_tokens", at),
            span_count: t.span_count === null || t.span_count === undefined ? undefined : num(t, "span_count", at),
            error_span_count: t.error_span_count === null || t.error_span_count === undefined ? undefined : num(t, "error_span_count", at),
            prompt: str(t, "prompt", at),
          };
        }),
      };
    }),
  };
}

export function parseTurnSpans(body: unknown): TurnSpans {
  if (!isRecord(body)) throw new InvalidResponse("body is not an object");
  return {
    trace_id: str(body, "trace_id", "body"),
    session_id: str(body, "session_id", "body"),
    spans: list(body, "spans", "body").map((s, i): TurnSpan => {
      const where = `spans[${i}]`;
      const started = time(s, "started_at", where);
      return {
        span_id: str(s, "span_id", where),
        parent_span_id: str(s, "parent_span_id", where),
        kind: str(s, "kind", where),
        name: str(s, "name", where),
        status: str(s, "status", where),
        call_kind: str(s, "call_kind", where),
        thread_id: str(s, "thread_id", where),
        model: str(s, "model", where),
        started,
        ended: started + Math.max(0, num(s, "duration_ns", where)) / NS_PER_MS,
        input_tokens: num(s, "input_tokens", where),
        output_tokens: num(s, "output_tokens", where),
      };
    }),
  };
}

/** The session's own title, else its first real prompt; "" when it has neither. */
export function sessionTitle(s: TimelineSession): string {
  if (s.title && !ID_LIKE.test(s.title)) return s.title;
  return s.turns.find((t) => !t.synthetic && t.prompt.trim())?.prompt.trim() ?? "";
}

/** Title and branch-name generators run one turn of five spans; such one-shot sessions crowd the timeline. */
export const TINY_SESSION_SPANS = 5;
export const isTinySession = (s: TimelineSession) =>
  s.turn_count <= 1 && s.turns.every((t) => t.span_count !== undefined) && s.turns.reduce((n, t) => n + (t.span_count ?? 0), 0) <= TINY_SESSION_SPANS;

/* ---------- Lanes ---------- */

export interface Lane {
  session: TimelineSession;
  /** 0 for a top-level session, 1+ for a subagent session under its parent. */
  depth: number;
  parent?: TimelineSession;
}

export interface LaneGroup {
  repo: string;
  lanes: Lane[];
  lastActive: number;
}

/**
 * Sessions grouped by repository, most recently active group first. Inside a
 * group, sessions run in start order and each subagent session sits directly
 * under the session that spawned it.
 */
export function laneGroups(sessions: TimelineSession[]): LaneGroup[] {
  const byId = new Map(sessions.map((s) => [s.session_id, s]));
  const children = new Map<string, TimelineSession[]>();
  const roots: TimelineSession[] = [];
  for (const s of sessions) {
    const parent = s.parent_session_id && s.parent_session_id !== s.session_id ? byId.get(s.parent_session_id) : undefined;
    if (parent) children.set(parent.session_id, [...(children.get(parent.session_id) ?? []), s]);
    else roots.push(s);
  }
  const byStart = (a: TimelineSession, b: TimelineSession) => a.started - b.started || a.session_id.localeCompare(b.session_id);
  const groups = new Map<string, LaneGroup>();
  const visit = (s: TimelineSession, depth: number, parent: TimelineSession | undefined, group: LaneGroup, seen: Set<string>) => {
    if (seen.has(s.session_id)) return;
    seen.add(s.session_id);
    group.lanes.push({ session: s, depth, parent });
    group.lastActive = Math.max(group.lastActive, s.last_seen);
    for (const child of (children.get(s.session_id) ?? []).sort(byStart)) visit(child, depth + 1, s, group, seen);
  };
  const seen = new Set<string>();
  for (const root of roots.sort(byStart)) {
    const repo = repoOf(root.cwd);
    const group = groups.get(repo) ?? { repo, lanes: [], lastActive: 0 };
    groups.set(repo, group);
    visit(root, 0, undefined, group, seen);
  }
  return [...groups.values()].sort((a, b) => b.lastActive - a.lastActive || a.repo.localeCompare(b.repo));
}

/* ---------- Time axis ---------- */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const STEPS = [MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];

/** Tick times aligned to local clock boundaries, about `target` of them across the window. */
export function ticks(since: number, until: number, target = 8, offsetMinutes = new Date(since).getTimezoneOffset()): number[] {
  const span = until - since;
  const step = STEPS.find((s) => span / s <= target) ?? STEPS[STEPS.length - 1]!;
  const offset = -offsetMinutes * MINUTE;
  const first = Math.ceil((since + offset) / step) * step - offset;
  const out: number[] = [];
  for (let t = first; t <= until; t += step) out.push(t);
  return out;
}

export interface Window {
  since: number;
  until: number;
}

export const RANGES = { "6h": 6 * HOUR, "24h": DAY, "3d": 3 * DAY, "7d": 7 * DAY } as const;
export type RangeKey = keyof typeof RANGES;

/** Local night hours (22:00 to 07:00) inside the window, for shading. */
export function nights(since: number, until: number): Window[] {
  const out: Window[] = [];
  const day = new Date(since);
  day.setHours(0, 0, 0, 0);
  for (let d = day.getTime() - DAY; d <= until; ) {
    const start = new Date(d);
    start.setHours(22, 0, 0, 0);
    const end = new Date(d);
    end.setDate(end.getDate() + 1);
    end.setHours(7, 0, 0, 0);
    if (end.getTime() > since && start.getTime() < until) {
      out.push({ since: Math.max(since, start.getTime()), until: Math.min(until, end.getTime()) });
    }
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    d = next.getTime();
  }
  return out;
}

/* ---------- Span threads ---------- */

export interface Thread {
  id: string;
  /** The agent span that opened this thread, absent for the main thread. */
  agent?: TurnSpan;
  spans: TurnSpan[];
}

/**
 * One row per thread: the main thread first, then each subagent thread in the
 * order it started. Agent spans mark where a thread opens and closes and are
 * not drawn as bars.
 */
export function threads(spans: TurnSpan[]): Thread[] {
  const agents = new Map(spans.filter((s) => s.kind === "agent" && s.thread_id).map((s) => [s.thread_id, s]));
  const rows = new Map<string, Thread>([["", { id: "", spans: [] }]]);
  const ordered = [...spans].sort((a, b) => a.started - b.started);
  for (const s of ordered) {
    if (s.kind === "agent") continue;
    const id = s.thread_id;
    const row = rows.get(id) ?? { id, agent: agents.get(id), spans: [] };
    rows.set(id, row);
    row.spans.push(s);
  }
  for (const [id, agent] of agents) if (!rows.has(id)) rows.set(id, { id, agent, spans: [] });
  const main = rows.get("")!;
  const rest = [...rows.values()].filter((r) => r.id !== "").sort((a, b) => (a.agent?.started ?? a.spans[0]?.started ?? 0) - (b.agent?.started ?? b.spans[0]?.started ?? 0));
  return [main, ...rest];
}

/* ---------- Gap-compressed scale ---------- */

export interface Segment {
  t0: number;
  t1: number;
  x0: number;
  x1: number;
  gap: boolean;
}

/**
 * A piecewise-linear time scale that squeezes idle gaps longer than `maxGap`
 * to `gapWidth` pixels, so a turn that waited hours between bursts still shows
 * each burst at a readable width.
 */
export function compressedScale(intervals: Window[], width: number, maxGap: number, gapWidth = 14): { x: (t: number) => number; segments: Segment[] } {
  const sorted = intervals.filter((i) => Number.isFinite(i.since)).sort((a, b) => a.since - b.since);
  if (sorted.length === 0) return { x: () => 0, segments: [] };
  const merged: Window[] = [];
  for (const i of sorted) {
    const last = merged[merged.length - 1];
    if (last && i.since - last.until <= maxGap) last.until = Math.max(last.until, i.until);
    else merged.push({ since: i.since, until: Math.max(i.since, i.until) });
  }
  const gaps = merged.length - 1;
  const active = merged.reduce((sum, m) => sum + (m.until - m.since), 0);
  const free = Math.max(0, width - gaps * gapWidth);
  // Bursts of zero length still get a sliver so their spans are visible.
  const minWidth = Math.min(6, free / merged.length);
  const flexible = Math.max(0, free - minWidth * merged.length);
  const segments: Segment[] = [];
  let x = 0;
  merged.forEach((m, i) => {
    const w = minWidth + (active > 0 ? ((m.until - m.since) / active) * flexible : flexible / merged.length);
    segments.push({ t0: m.since, t1: m.until, x0: x, x1: x + w, gap: false });
    x += w;
    const next = merged[i + 1];
    if (next) {
      segments.push({ t0: m.until, t1: next.since, x0: x, x1: x + gapWidth, gap: true });
      x += gapWidth;
    }
  });
  const scale = (t: number) => {
    if (t <= segments[0]!.t0) return segments[0]!.x0;
    for (const s of segments) {
      if (t <= s.t1) return s.t1 === s.t0 ? s.x0 : s.x0 + ((t - s.t0) / (s.t1 - s.t0)) * (s.x1 - s.x0);
    }
    return segments[segments.length - 1]!.x1;
  };
  return { x: scale, segments };
}
