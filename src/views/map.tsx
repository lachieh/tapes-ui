import ForceGraph3D, { type ForceGraph3DInstance } from "3d-force-graph";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { api, sessionTracesUpTo, type SessionTraces } from "../api";
import { colour, escapeHtml, shortId } from "../format";
import { href, useLoad } from "../hooks";
import { buildGraph, type MapEdge, type MapNode } from "../map/graph";
import { EmbeddingMap } from "./embedding-map";

const MAX_SESSION_PAGES = 10;
const CONCURRENT_SESSION_LOADS = 4;

interface Options {
  session?: string;
  sessions: number;
  turns: number;
  spans: boolean;
  flows: boolean;
}

const EDGE_COLOUR: Record<MapEdge["type"], string> = {
  turn: "rgba(230,230,230,0.35)",
  next: "rgba(255,255,255,0.6)",
  child: "rgba(160,160,160,0.25)",
  flow: "rgba(242,142,43,0.5)",
};

async function recentSessionsWithTurns(n: number, signal: AbortSignal): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_SESSION_PAGES && ids.length < n; page++) {
    const res = await api.sessions({ limit: 200, cursor }, signal);
    ids.push(...res.items.filter((s) => s.rollup.turn_count > 0).map((s) => s.id));
    if (!res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return ids.slice(0, n);
}

async function loadSessions(opts: Options, signal: AbortSignal, progress: (n: number, of: number) => void) {
  const ids = opts.session ? [opts.session] : await recentSessionsWithTurns(opts.sessions, signal);
  const out: SessionTraces[] = [];
  for (let i = 0; i < ids.length; i += CONCURRENT_SESSION_LOADS) {
    const batch = await Promise.all(ids.slice(i, i + CONCURRENT_SESSION_LOADS).map((id) => sessionTracesUpTo(id, opts.turns, signal)));
    out.push(...batch);
    progress(out.length, ids.length);
  }
  return out;
}

export function MapView({ params }: { params: URLSearchParams }) {
  const embedding = params.get("layout") === "embedding";
  const layoutSwitch = (
    <span class="segmented" role="group" aria-label="Layout">
      <a href={href("/map")} class={embedding ? "" : "active"}>Structure</a>
      <a href={href("/map", { layout: "embedding" })} class={embedding ? "active" : ""}>Embedding</a>
    </span>
  );
  return embedding
    ? <EmbeddingMap params={params} layoutSwitch={layoutSwitch} />
    : <StructureMap params={params} layoutSwitch={layoutSwitch} />;
}

function StructureMap({ params, layoutSwitch }: { params: URLSearchParams; layoutSwitch: ComponentChildren }) {
  const opts: Options = {
    session: params.get("session") ?? undefined,
    sessions: Number(params.get("sessions") ?? 15),
    turns: Number(params.get("turns") ?? 30),
    spans: params.get("spans") !== "0",
    flows: params.get("flows") === "1",
  };
  const set = (key: keyof Options, value: string | number) => {
    location.hash = href("/map", { ...Object.fromEntries(params), [key]: value });
  };

  const [progress, setProgress] = useState("");
  const data = useLoad(
    (signal) => loadSessions(opts, signal, (n, of) => setProgress(`${n}/${of} sessions`)),
    [opts.session, opts.sessions, opts.turns],
  );
  const graph = useMemo(
    () => (data.state === "ready" ? buildGraph(data.data, { includeSpans: opts.spans, includeFlows: opts.flows }) : undefined),
    [data, opts.spans, opts.flows],
  );
  const [selected, setSelected] = useState<MapNode | undefined>();

  return (
    <div class="map-page">
      <div class="toolbar map-toolbar">
        {layoutSwitch}
        {opts.session ? (
          <span>
            Session <a href={href("/session", { id: opts.session })}>{shortId(opts.session)}</a> ·{" "}
            <a href={href("/map", { sessions: opts.sessions })}>show recent sessions</a>
          </span>
        ) : (
          <label>
            Recent sessions{" "}
            <select value={opts.sessions} onChange={(e) => set("sessions", e.currentTarget.value)}>
              {[5, 15, 30, 60].map((n) => <option value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <label>
          Turns per session{" "}
          <select value={opts.turns} onChange={(e) => set("turns", e.currentTarget.value)}>
            {[10, 30, 100, 200].map((n) => <option value={n}>{n}</option>)}
          </select>
        </label>
        <label><input type="checkbox" checked={opts.spans} onChange={(e) => set("spans", e.currentTarget.checked ? 1 : 0)} /> Spans</label>
        <label><input type="checkbox" checked={opts.flows} disabled={!opts.spans} onChange={(e) => set("flows", e.currentTarget.checked ? 1 : 0)} /> Data flow links</label>
        {graph && <span class="muted">{graph.nodes.length} nodes · {graph.links.length} links</span>}
        {data.state === "loading" && <span class="muted">Loading {progress}…</span>}
        {data.state === "error" && <span class="error">{data.error}</span>}
      </div>
      <div class="map-body">
        {graph?.nodes.length === 0 && <p class="page muted">No sessions with derived turns found.</p>}
        {graph && graph.nodes.length > 0 && <Graph nodes={graph.nodes} links={graph.links} onSelect={setSelected} />}
        <Legend />
        {selected && <NodePanel node={selected} onClose={() => setSelected(undefined)} />}
      </div>
    </div>
  );
}

function Graph({ nodes, links, onSelect }: { nodes: MapNode[]; links: MapEdge[]; onSelect: (n: MapNode) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraph3DInstance<MapNode, MapEdge>>(undefined);
  const zoomToFitPending = useRef(true);

  useEffect(() => {
    const container = el.current!;
    const g = new ForceGraph3D(container) as unknown as ForceGraph3DInstance<MapNode, MapEdge>;
    g.backgroundColor("#0d0f12")
      .showNavInfo(false)
      .nodeLabel((n) => escapeHtml(`${n.type}: ${n.label}`))
      .nodeColor((n) => colour(n.type === "session" ? "session" : n.colourKey))
      .nodeVal((n) => n.val)
      .nodeOpacity(0.9)
      .linkColor((l) => EDGE_COLOUR[l.type])
      .linkWidth((l) => (l.type === "next" ? 0.8 : 0))
      .linkDirectionalArrowLength((l) => (l.type === "next" || l.type === "flow" ? 2.5 : 0))
      .linkDirectionalArrowRelPos(1)
      .warmupTicks(40)
      .cooldownTime(8000)
      .onEngineStop(() => {
        if (zoomToFitPending.current) g.zoomToFit(800, 40);
        zoomToFitPending.current = false;
      })
      .onNodeClick((n) => {
        onSelect(n);
        const { x = 0, y = 0, z = 0 } = n as MapNode & { x?: number; y?: number; z?: number };
        const r = 1 + 80 / Math.hypot(x, y, z || 1);
        g.cameraPosition({ x: x * r, y: y * r, z: z * r }, { x, y, z }, 1000);
      });
    const resize = new ResizeObserver(() => g.width(container.clientWidth).height(container.clientHeight));
    resize.observe(container);
    fg.current = g;
    return () => {
      resize.disconnect();
      g._destructor();
      container.replaceChildren();
    };
  }, []);

  useEffect(() => {
    // d3-force-3d mutates the nodes (x/y/z, velocities) and links
    // (source/target) it is given, so hand it copies.
    fg.current?.graphData({ nodes: nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) });
    zoomToFitPending.current = true;
  }, [nodes, links]);

  return <div class="graph" ref={el} />;
}

function Legend() {
  const items = [
    ["session", "session"], ["turn ok", "ok"], ["turn error", "error"],
    ["llm span", "llm"], ["tool span", "tool"], ["agent span", "agent"], ["event span", "event"],
  ];
  return (
    <ul class="legend">
      {items.map(([label, key]) => <li><span class="dot" style={{ background: colour(key!) }} />{label}</li>)}
    </ul>
  );
}

function NodePanel({ node, onClose }: { node: MapNode; onClose: () => void }) {
  return (
    <aside class="node-panel">
      <button class="close" onClick={onClose} aria-label="Close">×</button>
      <div class="muted">{node.type} · {node.colourKey}</div>
      <p>{node.label}</p>
      <a href={href("/session", { id: node.sessionId, turn: node.traceId })}>Open session</a>
      {node.type === "session" && <> · <a href={href("/map", { session: node.sessionId })}>Map this session</a></>}
    </aside>
  );
}
