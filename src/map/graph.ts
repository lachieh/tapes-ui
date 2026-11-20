import type { SessionTraces } from "../api";

export type NodeType = "session" | "turn" | "span";
export type EdgeType = "turn" | "next" | "child" | "flow";

export interface MapNode {
  id: string;
  type: NodeType;
  label: string;
  colourKey: string;
  sessionId: string;
  traceId?: string;
  spanId?: string;
  val: number;
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
  includeSpans: boolean;
  includeFlows: boolean;
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
    ids.add(node.id);
    nodes.push(node);
  };

  for (const { session, traces, links: spanLinks } of sessions) {
    add({
      id: session.id,
      type: "session",
      label: clip(session.display_title || session.rollup.preview || session.id, 80),
      colourKey: session.harness_id || "unknown",
      sessionId: session.id,
      val: 12,
    });

    let previous: string | undefined;
    for (const { trace, spans } of traces) {
      add({
        id: trace.trace_id,
        type: "turn",
        label: clip(trace.user_prompt || "(synthetic turn)", 80),
        colourKey: trace.status || "unknown",
        sessionId: session.id,
        traceId: trace.trace_id,
        val: 4,
      });
      links.push({ source: session.id, target: trace.trace_id, type: "turn" });
      if (previous) links.push({ source: previous, target: trace.trace_id, type: "next" });
      previous = trace.trace_id;

      if (!opts.includeSpans) continue;
      const inTrace = new Set(spans.map((s) => s.span_id));
      for (const span of spans) {
        const id = spanNodeId(trace.trace_id, span.span_id);
        add({
          id,
          type: "span",
          label: clip(span.model ? `${span.kind}: ${span.model}` : `${span.kind}: ${span.name}`, 80),
          colourKey: span.kind || "unknown",
          sessionId: session.id,
          traceId: trace.trace_id,
          spanId: span.span_id,
          val: 1,
        });
        const parent = span.parent_span_id && inTrace.has(span.parent_span_id)
          ? spanNodeId(trace.trace_id, span.parent_span_id)
          : trace.trace_id;
        links.push({ source: parent, target: id, type: "child" });
      }
    }

    if (opts.includeSpans && opts.includeFlows) {
      for (const l of spanLinks ?? []) {
        const source = spanNodeId(l.from_trace_id, l.from_span_id);
        const target = spanNodeId(l.to_trace_id, l.to_span_id);
        if (ids.has(source) && ids.has(target) && source !== target) {
          links.push({ source, target, type: "flow" });
        }
      }
    }
  }

  return { nodes, links };
}
