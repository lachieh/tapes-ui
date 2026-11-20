import type { SessionTraces } from "../api";

// The structural map: sessions -> turns (traces) -> spans, following each
// span's parent_span_id. Built only from the read API's trace projection.
//
// Phase 2 (embedding map) will position nodes from a map cassette's 3D
// coordinates instead of the force layout; it can reuse these node ids
// (session id, trace id, `${trace_id}/${span_id}`) to join the two views.

export type NodeType = "session" | "turn" | "span";
export type EdgeType = "turn" | "next" | "child" | "flow";

export interface MapNode {
  id: string;
  type: NodeType;
  label: string;
  group: string; // colour key: harness for sessions, status for turns, kind for spans
  sessionId: string;
  traceId?: string;
  spanId?: string;
  val: number; // relative node size
}

export interface MapEdge {
  source: string;
  target: string;
  type: EdgeType;
}

export interface MapGraph {
  nodes: MapNode[];
  links: MapEdge[];
}

export interface BuildOptions {
  spans: boolean; // include span nodes
  flows: boolean; // include emits/feeds links between spans
}

export const spanNodeId = (traceId: string, spanId: string) => `${traceId}/${spanId}`;

function clip(text: string | undefined, n: number): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function buildGraph(sessions: SessionTraces[], opts: BuildOptions): MapGraph {
  const nodes: MapNode[] = [];
  const links: MapEdge[] = [];
  const ids = new Set<string>();
  const add = (node: MapNode) => {
    if (ids.has(node.id)) return false;
    ids.add(node.id);
    nodes.push(node);
    return true;
  };

  for (const { session, traces, links: spanLinks } of sessions) {
    add({
      id: session.id,
      type: "session",
      label: clip(session.display_title || session.rollup.preview || session.id, 80),
      group: session.harness_id || "unknown",
      sessionId: session.id,
      val: 12,
    });

    let previous: string | undefined;
    for (const { trace, spans } of traces) {
      if (!add({
        id: trace.trace_id,
        type: "turn",
        label: clip(trace.user_prompt || "(synthetic turn)", 80),
        group: trace.status || "unknown",
        sessionId: session.id,
        traceId: trace.trace_id,
        val: 4,
      })) continue;
      links.push({ source: session.id, target: trace.trace_id, type: "turn" });
      if (previous) links.push({ source: previous, target: trace.trace_id, type: "next" });
      previous = trace.trace_id;

      if (!opts.spans) continue;
      const inTrace = new Set(spans.map((s) => s.span_id));
      for (const span of spans) {
        const id = spanNodeId(trace.trace_id, span.span_id);
        if (!add({
          id,
          type: "span",
          label: clip(span.model ? `${span.kind}: ${span.model}` : `${span.kind}: ${span.name}`, 80),
          group: span.kind || "unknown",
          sessionId: session.id,
          traceId: trace.trace_id,
          spanId: span.span_id,
          val: 1,
        })) continue;
        const parent = span.parent_span_id && inTrace.has(span.parent_span_id)
          ? spanNodeId(trace.trace_id, span.parent_span_id)
          : trace.trace_id;
        links.push({ source: parent, target: id, type: "child" });
      }
    }

    if (opts.spans && opts.flows) {
      for (const l of spanLinks ?? []) {
        const source = spanNodeId(l.from_trace_id, l.from_span_id);
        const target = spanNodeId(l.to_trace_id, l.to_span_id);
        if (ids.has(source) && ids.has(target) && source !== target) {
          links.push({ source, target, type: "flow" });
        }
      }
    }
  }

  // Parents can appear after children in a page, so drop edges to nodes that
  // never arrived rather than let the force layout throw on them.
  return { nodes, links: links.filter((l) => ids.has(l.source) && ids.has(l.target)) };
}
