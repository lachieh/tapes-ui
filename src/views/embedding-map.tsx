import ForceGraph3D, { type ForceGraph3DInstance } from "3d-force-graph";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { api, ApiError } from "../api";
import { ago, colour, escapeHtml } from "../format";
import { href, useLoad } from "../hooks";
import {
  countBy, filterPoints, harnessOf, isTempWorkspace, projectOf, toNodes,
  type ColourBy, type EmbeddingNode, type MapPoint, type MapPoints,
} from "../map/embedding";

const LEGEND_SIZE = 10;

type PointsResult = { state: "computing" } | { state: "not-installed" } | { state: "ready"; data: MapPoints };

async function loadPoints(signal: AbortSignal): Promise<PointsResult> {
  try {
    return { state: "ready", data: await api.mapPoints(signal) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) return { state: "computing" };
    if (err instanceof ApiError && err.status === 404) return { state: "not-installed" };
    throw err;
  }
}

export function EmbeddingMap({ params, layoutSwitch }: { params: URLSearchParams; layoutSwitch: ComponentChildren }) {
  const colourBy: ColourBy = params.get("colour") === "project" ? "project" : "harness";
  const harnessParam = params.get("harness");
  const shownHarnesses = useMemo(() => (harnessParam === null ? undefined : new Set(harnessParam.split(",").filter(Boolean))), [harnessParam]);
  const text = params.get("q") ?? "";
  const includeTempWorkspaces = params.get("temp") === "1";
  const set = (changes: Record<string, string | undefined>) => {
    location.hash = href("/map", { ...Object.fromEntries(params), ...changes });
  };

  const [attempt, setAttempt] = useState(0);
  const result = useLoad(loadPoints, [attempt]);
  const points = result.state === "ready" && result.data.state === "ready" ? result.data.data : undefined;

  const visible = useMemo(
    () => (points ? filterPoints(points.points, { harnesses: shownHarnesses, text, includeTempWorkspaces }) : []),
    [points, shownHarnesses, text, includeTempWorkspaces],
  );
  const nodes = useMemo(() => toNodes(visible, colourBy), [visible, colourBy]);
  const harnesses = useMemo(() => (points ? countBy(points.points, harnessOf) : []), [points]);
  const tempCount = useMemo(() => (points ? points.points.filter(isTempWorkspace).length : 0), [points]);
  const [selected, setSelected] = useState<MapPoint | undefined>();

  const toggleHarness = (harness: string) => {
    const next = new Set(shownHarnesses ?? harnesses.map(([h]) => h));
    if (next.has(harness)) next.delete(harness);
    else next.add(harness);
    set({ harness: next.size === harnesses.length ? undefined : [...next].join(",") || "," });
  };

  return (
    <div class="map-page">
      <div class="toolbar map-toolbar">
        {layoutSwitch}
        <label>
          Colour by{" "}
          <select value={colourBy} onChange={(e) => set({ colour: e.currentTarget.value === "project" ? "project" : undefined })}>
            <option value="harness">harness</option>
            <option value="project">project</option>
          </select>
        </label>
        <span class="harness-toggles">
          {harnesses.map(([harness, n]) => (
            <label>
              <input type="checkbox" checked={!shownHarnesses || shownHarnesses.has(harness)} onChange={() => toggleHarness(harness)} />{" "}
              <span class="dot" style={{ background: colour(harness) }} />{harness} <span class="muted">{n}</span>
            </label>
          ))}
        </span>
        <label>
          <input type="checkbox" checked={includeTempWorkspaces} onChange={(e) => set({ temp: e.currentTarget.checked ? "1" : undefined })} />{" "}
          Temp workspaces <span class="muted">{tempCount}</span>
        </label>
        <input
          type="search"
          placeholder="Filter project or title"
          value={text}
          onChange={(e) => set({ q: e.currentTarget.value || undefined })}
        />
        {points && (
          <span class="muted">
            {visible.length} of {points.points.length} sessions · computed <span title={points.computed_at}>{ago(points.computed_at)}</span>
          </span>
        )}
        {result.state === "loading" && <span class="muted">Loading points…</span>}
      </div>
      <div class="map-body">
        {result.state === "error" && <p class="page error">{result.error}</p>}
        {result.state === "ready" && result.data.state === "computing" && (
          <p class="page muted">The map cassette is still computing. <button class="link" onClick={() => setAttempt((n) => n + 1)}>Retry</button></p>
        )}
        {result.state === "ready" && result.data.state === "not-installed" && <p class="page muted">The map cassette isn't installed.</p>}
        {points && visible.length === 0 && <p class="page muted">No sessions match these filters.</p>}
        {points && visible.length > 0 && <PointCloud nodes={nodes} onSelect={setSelected} />}
        {points && <ColourLegend points={visible} colourBy={colourBy} />}
        {selected && <PointPanel point={selected} onClose={() => setSelected(undefined)} />}
      </div>
    </div>
  );
}

function PointCloud({ nodes, onSelect }: { nodes: EmbeddingNode[]; onSelect: (p: MapPoint) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraph3DInstance<EmbeddingNode>>(undefined);
  const fitted = useRef(false);

  useEffect(() => {
    const container = el.current!;
    const g = new ForceGraph3D(container) as unknown as ForceGraph3DInstance<EmbeddingNode>;
    g.backgroundColor("#0d0f12")
      .showNavInfo(false)
      .nodeLabel((n) => escapeHtml(n.point.title || n.id))
      .nodeColor((n) => colour(n.colourKey))
      .nodeVal((n) => n.val)
      .nodeResolution(6)
      .nodeOpacity(0.9)
      .cooldownTicks(0)
      .onEngineStop(() => {
        if (fitted.current || g.graphData().nodes.length === 0) return;
        fitted.current = true;
        requestAnimationFrame(() => g.zoomToFit(0, 40));
      })
      .onNodeClick((n) => {
        onSelect(n.point);
        const r = 1 + 150 / Math.hypot(n.x, n.y, n.z || 1);
        g.cameraPosition({ x: n.x * r, y: n.y * r, z: n.z * r }, { x: n.x, y: n.y, z: n.z }, 1000);
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
    fg.current?.graphData({ nodes: nodes.map((n) => ({ ...n, fx: n.x, fy: n.y, fz: n.z })), links: [] });
  }, [nodes]);

  return <div class="graph" ref={el} />;
}

function ColourLegend({ points, colourBy }: { points: MapPoint[]; colourBy: ColourBy }) {
  const counts = countBy(points, colourBy === "harness" ? harnessOf : projectOf);
  const others = counts.slice(LEGEND_SIZE).reduce((sum, [, n]) => sum + n, 0);
  return (
    <ul class="legend">
      {counts.slice(0, LEGEND_SIZE).map(([key, n]) => (
        <li><span class="dot" style={{ background: colour(key) }} />{key} <span class="muted">{n}</span></li>
      ))}
      {others > 0 && <li class="muted">{counts.length - LEGEND_SIZE} more · {others} sessions</li>}
    </ul>
  );
}

function PointPanel({ point, onClose }: { point: MapPoint; onClose: () => void }) {
  return (
    <aside class="node-panel">
      <button class="close" onClick={onClose} aria-label="Close">×</button>
      <div class="muted">
        <span class="dot" style={{ background: colour(harnessOf(point)) }} />{harnessOf(point)} · <span title={point.cwd}>{projectOf(point)}</span>
      </div>
      <p>{point.title || point.session_id}</p>
      <div class="muted">
        {point.span_count} spans · last seen <span title={point.last_seen_at}>{ago(point.last_seen_at)}</span>
      </div>
      <p>
        <a href={href("/session", { id: point.session_id })}>Open session</a> ·{" "}
        <a href={href("/map", { session: point.session_id })}>Map this session</a>
      </p>
    </aside>
  );
}
