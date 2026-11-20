import { describe, expect, it } from "vitest";
import type { SessionTraces, Span } from "../api";
import { buildGraph } from "./graph";

const span = (trace_id: string, span_id: string, kind: string, parent_span_id?: string): Span => ({
  trace_id, span_id, parent_span_id, kind, name: kind, status: "ok", started_at: "",
});

const fixture: SessionTraces = {
  session: {
    id: "s1", harness_id: "claude", started_at: "", last_seen_at: "",
    live: false, display_title: "Fix the thing", rollup: { status: "completed", turn_count: 2, usage: {} },
  },
  traces: [
    {
      trace: { trace_id: "t1", status: "ok", started_at: "", span_count: 3 },
      spans: [span("t1", "agent", "agent"), span("t1", "llm", "llm", "agent"), span("t1", "tool", "tool", "agent")],
    },
    {
      trace: { trace_id: "t2", status: "error", started_at: "", span_count: 1 },
      // Parent outside the page: attach to the turn instead of dangling.
      spans: [span("t2", "orphan", "tool", "missing")],
    },
  ],
  links: [
    { kind: "emits", from_trace_id: "t1", from_span_id: "llm", to_trace_id: "t1", to_span_id: "tool" },
    { kind: "feeds", from_trace_id: "t1", from_span_id: "llm", to_trace_id: "tX", to_span_id: "gone" },
  ],
};

const edges = (g: ReturnType<typeof buildGraph>) => g.links.map((l) => `${l.type}:${l.source}->${l.target}`).sort();

describe("buildGraph", () => {
  it("links session to turns, turns in order, and spans by parent", () => {
    const g = buildGraph([fixture], { spans: true, flows: true });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(
      ["s1", "t1", "t1/agent", "t1/llm", "t1/tool", "t2", "t2/orphan"].sort(),
    );
    expect(edges(g)).toEqual([
      "child:t1->t1/agent",
      "child:t1/agent->t1/llm",
      "child:t1/agent->t1/tool",
      "child:t2->t2/orphan",
      "flow:t1/llm->t1/tool",
      "next:t1->t2",
      "turn:s1->t1",
      "turn:s1->t2",
    ]);
  });

  it("omits spans and flows when disabled", () => {
    const g = buildGraph([fixture], { spans: false, flows: true });
    expect(g.nodes.map((n) => n.type)).toEqual(["session", "turn", "turn"]);
    expect(edges(g)).toEqual(["next:t1->t2", "turn:s1->t1", "turn:s1->t2"]);
  });

  it("colours sessions by harness, turns by status, spans by kind", () => {
    const g = buildGraph([fixture], { spans: true, flows: false });
    const group = Object.fromEntries(g.nodes.map((n) => [n.id, n.group]));
    expect(group).toMatchObject({ s1: "claude", t2: "error", "t1/llm": "llm" });
  });
});
