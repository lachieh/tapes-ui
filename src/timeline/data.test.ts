import { describe, expect, it } from "vitest";
import { compressedScale, laneGroups, nights, parseTimeline, parseTurnSpans, threads, ticks, type TimelineSession, type TurnSpan } from "./data";

const T0 = Date.parse("2026-11-20T00:00:00Z");
const MIN = 60_000;

const session = (id: string, cwd: string, started: number, parent = "", last_seen = started + 10 * MIN): TimelineSession => ({
  session_id: id, parent_session_id: parent, harness_id: "claude", cwd, title: id, started, last_seen,
  status: "ok", turn_count: 0, cost_usd: 0, tool_error_count: 0, turns: [],
});

describe("parseTimeline", () => {
  it("reads sessions and turns, with numerics given as strings", () => {
    const t = parseTimeline({
      since: "2026-11-20T00:00:00Z", until: "2026-11-21T00:00:00Z",
      sessions: [{
        session_id: "s", parent_session_id: null, harness_id: "codex", cwd: "/p", title: "t",
        started_at: "2026-11-20T01:00:00Z", last_seen_at: "2026-11-20T02:00:00Z", ended_at: null,
        status: "ok", turn_count: 1, cost_usd: "0.25", tool_error_count: 0,
        turns: [{ trace_id: "tr", started_at: "2026-11-20T01:00:00Z", ended_at: null, duration_ns: 30e9, status: "error", synthetic: false, cost_usd: 0.1, span_count: 4, error_span_count: 1, prompt: "hi" }],
      }],
    });
    expect(t.sessions[0]).toMatchObject({ parent_session_id: "", cost_usd: 0.25, ended: undefined });
    expect(t.sessions[0]!.turns[0]).toMatchObject({ trace_id: "tr", status: "error", span_count: 4 });
    expect(t.sessions[0]!.turns[0]!.ended - t.sessions[0]!.turns[0]!.started).toBe(30_000);
  });

  it("rejects bad timestamps and non-array sessions", () => {
    expect(() => parseTimeline({ since: "x", until: "2026-11-21T00:00:00Z", sessions: [] })).toThrow("since");
    expect(() => parseTimeline({ since: "2026-11-20T00:00:00Z", until: "2026-11-21T00:00:00Z", sessions: {} })).toThrow("sessions is not an array");
  });
});

describe("laneGroups", () => {
  it("groups by repo, newest group first, with subagents under their parent", () => {
    const groups = laneGroups([
      session("old", "/Users/l/Projects/homelab", T0),
      session("parent", "/Users/l/Projects/charming", T0 + MIN, "", T0 + 60 * MIN),
      session("child", "/Users/l/.codex/worktrees/ab12/charming", T0 + 5 * MIN, "parent"),
      session("grandchild", "/tmp/x", T0 + 6 * MIN, "child"),
      session("later", "/Users/l/Projects/charming", T0 + 2 * MIN),
    ]);
    expect(groups.map((g) => g.repo)).toEqual(["charming", "homelab"]);
    expect(groups[0]!.lanes.map((l) => [l.session.session_id, l.depth])).toEqual([["parent", 0], ["child", 1], ["grandchild", 2], ["later", 0]]);
    expect(groups[0]!.lanes[1]!.parent?.session_id).toBe("parent");
  });

  it("treats a session whose parent is outside the window as top-level", () => {
    const groups = laneGroups([session("orphan", "/p/x", T0, "missing")]);
    expect(groups[0]!.lanes[0]).toMatchObject({ depth: 0 });
  });
});

describe("ticks", () => {
  it("aligns to round local times", () => {
    const t = ticks(T0 + 7 * MIN, T0 + 6 * 60 * MIN, 8, 0);
    expect(t[0]).toBe(T0 + 60 * MIN);
    expect(t.every((x, i) => i === 0 || x - t[i - 1]! === 60 * MIN)).toBe(true);
  });
});

describe("nights", () => {
  it("covers 22:00 to 07:00 local time", () => {
    const start = new Date(2026, 10, 20, 12).getTime();
    const n = nights(start, start + 24 * 60 * MIN);
    expect(n).toHaveLength(1);
    expect(new Date(n[0]!.since).getHours()).toBe(22);
    expect(new Date(n[0]!.until).getHours()).toBe(7);
  });
});

const span = (id: string, kind: string, thread: string, started: number, ms = 1000): TurnSpan => ({
  span_id: id, parent_span_id: "", kind, name: kind, status: "ok", call_kind: "", thread_id: thread, model: "",
  started, ended: started + ms, input_tokens: 0, output_tokens: 0,
});

describe("threads", () => {
  it("puts the main thread first and subagents in start order", () => {
    const rows = threads([
      span("a2", "agent", "t2", T0 + 50),
      span("a1", "agent", "t1", T0 + 10),
      span("m", "llm", "", T0),
      span("x", "tool", "t2", T0 + 60),
      span("y", "llm", "t1", T0 + 20),
    ]);
    expect(rows.map((r) => [r.id, r.spans.map((s) => s.span_id), r.agent?.span_id])).toEqual([
      ["", ["m"], undefined], ["t1", ["y"], "a1"], ["t2", ["x"], "a2"],
    ]);
  });

  it("parses span rows from the turn endpoint", () => {
    const parsed = parseTurnSpans({ trace_id: "t", session_id: "s", spans: [{ span_id: "a", started_at: "2026-11-20T00:00:00Z", duration_ns: 2e9 }] });
    expect(parsed.spans[0]!.ended - parsed.spans[0]!.started).toBe(2000);
  });
});

describe("compressedScale", () => {
  it("squeezes long idle gaps and keeps bursts proportional", () => {
    const hour = 60 * MIN;
    const { x, segments } = compressedScale(
      [{ since: 0, until: 10_000 }, { since: 5 * hour, until: 5 * hour + 30_000 }],
      1000, 60_000, 14,
    );
    expect(segments.map((s) => s.gap)).toEqual([false, true, false]);
    expect(segments[1]!.x1 - segments[1]!.x0).toBe(14);
    expect(x(0)).toBe(0);
    expect(x(5 * hour + 30_000)).toBeCloseTo(1000);
    // The 30 s burst gets about three times the width of the 10 s one.
    const w1 = segments[0]!.x1 - segments[0]!.x0;
    const w2 = segments[2]!.x1 - segments[2]!.x0;
    expect(w2 / w1).toBeGreaterThan(2.5);
  });

  it("merges intervals closer than the gap limit", () => {
    const { segments } = compressedScale([{ since: 0, until: 1000 }, { since: 1500, until: 2000 }], 100, 60_000);
    expect(segments).toHaveLength(1);
  });
});

describe("isTinySession", () => {
  it("catches one-turn generator sessions only", async () => {
    const { isTinySession } = await import("./data");
    const turn = (span_count: number) => ({ trace_id: "t", started: T0, ended: T0, status: "ok", synthetic: false, cost_usd: 0, input_tokens: 0, output_tokens: 0, span_count, error_span_count: 0, prompt: "" });
    expect(isTinySession({ ...session("a", "/p", T0), turn_count: 1, turns: [turn(5)] })).toBe(true);
    expect(isTinySession({ ...session("b", "/p", T0), turn_count: 1, turns: [turn(9)] })).toBe(false);
    expect(isTinySession({ ...session("c", "/p", T0), turn_count: 3, turns: [turn(1)] })).toBe(false);
    const uncounted = (ms: number) => ({ ...turn(0), span_count: undefined, ended: T0 + ms });
    expect(isTinySession({ ...session("d", "/p", T0), turn_count: 1, turns: [uncounted(8_000)] })).toBe(true);
    expect(isTinySession({ ...session("e", "/p", T0), turn_count: 1, turns: [uncounted(5 * MIN)] })).toBe(false);
  });
});
