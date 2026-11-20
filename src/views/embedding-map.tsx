import { useQuery } from "@tanstack/preact-query";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ago } from "../format";
import { href } from "../hooks";
import {
  harnessOf, isBackground, isLit, keyOf, palette, pointRadius, repoOf, robustBounds, TINY_SESSION_SPANS, titleOf,
  type ColourBy, type Highlight, type MapPoint, type Palette,
} from "../map/embedding";
import { mapPointsQuery } from "../queries";
import { QueryError } from "./status";

/** World units per unit of projected coordinate, before zoom. */
const WORLD = 1000;
const HIT_RADIUS = 10;
const DIM = "rgba(120, 128, 140, 0.16)";
const BACKGROUND = "#0d0f12";

export function EmbeddingMap({ params, layoutSwitch }: { params: URLSearchParams; layoutSwitch: ComponentChildren }) {
  const colourBy: ColourBy = params.get("colour") === "harness" ? "harness" : "repo";
  const onlyParam = params.get("only");
  const only = useMemo(() => (onlyParam ? new Set(onlyParam.split(",").filter(Boolean)) : undefined), [onlyParam]);
  const text = params.get("q") ?? "";
  const showBackground = params.get("all") === "1";
  const set = (changes: Record<string, string | undefined>) => {
    location.hash = href("/map", { ...Object.fromEntries(params), ...changes });
  };

  const result = useQuery(mapPointsQuery);
  const points = result.data?.state === "ready" ? result.data.data : undefined;

  const backgroundCount = useMemo(() => points?.points.filter(isBackground).length ?? 0, [points]);
  const shown = useMemo(
    () => (points ? (showBackground ? points.points : points.points.filter((p) => !isBackground(p))) : []),
    [points, showBackground],
  );
  const colours = useMemo(() => palette(shown, colourBy), [shown, colourBy]);
  const highlight: Highlight = useMemo(() => ({ only, text }), [only, text]);
  const lit = useMemo(() => new Set(shown.filter((p) => isLit(p, colourBy, highlight)).map((p) => p.session_id)), [shown, colourBy, highlight]);
  const highlighting = only !== undefined || text.trim() !== "";
  const [selected, setSelected] = useState<MapPoint | undefined>();

  const setOnly = (keys: Set<string> | undefined) => set({ only: keys && keys.size > 0 ? [...keys].join(",") : undefined });

  return (
    <div class="map-page">
      <div class="toolbar map-toolbar">
        {layoutSwitch}
        <label>
          Colour by{" "}
          <select value={colourBy} onChange={(e) => set({ colour: e.currentTarget.value === "harness" ? "harness" : undefined, only: undefined })}>
            <option value="repo">repo</option>
            <option value="harness">harness</option>
          </select>
        </label>
        <input
          type="search"
          aria-label="Highlight sessions by title or directory"
          placeholder="Highlight title or directory"
          value={text}
          onChange={(e) => set({ q: e.currentTarget.value || undefined })}
        />
        <label title={`Sessions with ${TINY_SESSION_SPANS} spans or fewer, and sessions run in temporary directories`}>
          <input type="checkbox" checked={showBackground} onChange={(e) => set({ all: e.currentTarget.checked ? "1" : undefined })} />{" "}
          Tiny and temp sessions <span class="muted">{backgroundCount}</span>
        </label>
        <span class="toolbar-status muted" aria-live="polite">
          {result.isPending && "Loading points…"}
          {points && (
            <>
              {highlighting ? `${lit.size.toLocaleString()} of ${shown.length.toLocaleString()} sessions` : `${shown.length.toLocaleString()} sessions`}
              {" · "}computed <span title={`${points.computed_at} · ${points.method} over ${points.model} embeddings`}>{ago(points.computed_at)}</span>
              {result.isFetching && " · refreshing"}
            </>
          )}
        </span>
      </div>
      <div class="map-body">
        {result.error && <div class="page"><QueryError error={result.error} retry={() => result.refetch()} /></div>}
        {result.data?.state === "computing" && <p class="page muted">The map cassette is computing its first projection. This page checks again every 10 seconds.</p>}
        {result.data?.state === "not-installed" && <p class="page muted">The map cassette isn't installed in this tapes deployment.</p>}
        {points && shown.length > 0 && (
          <PointCanvas points={shown} colourBy={colourBy} colours={colours} lit={lit} selected={selected} onSelect={setSelected} />
        )}
        {points && shown.length === 0 && <p class="page muted">No sessions to show.</p>}
        {points && highlighting && lit.size === 0 && <p class="map-note muted">Nothing matches. <button class="link" onClick={() => set({ only: undefined, q: undefined })}>Clear highlight</button></p>}
        {points && <Legend colours={colours} colourBy={colourBy} only={only} setOnly={setOnly} />}
        {selected && <PointPanel point={selected} colour={colours.colourOf(keyOf(selected, colourBy))} onClose={() => setSelected(undefined)} />}
      </div>
    </div>
  );
}

interface CanvasProps {
  points: MapPoint[];
  colourBy: ColourBy;
  colours: Palette;
  lit: ReadonlySet<string>;
  selected?: MapPoint;
  onSelect: (p: MapPoint | undefined) => void;
}

interface Scene {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  transform: ZoomTransform;
  fitK: number;
  hover?: MapPoint;
  frame?: number;
}

function PointCanvas({ points, colourBy, colours, lit, selected, onSelect }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene>(undefined);
  const zoomer = useRef<ZoomBehavior<HTMLCanvasElement, unknown>>(undefined);
  // The draw and hit-test callbacks read the latest props through this ref, so the
  // canvas, zoom behaviour and listeners are set up once.
  const props = useRef({ points, colourBy, colours, lit, selected, onSelect });
  props.current = { points, colourBy, colours, lit, selected, onSelect };

  // Large sessions first, so small ones stay visible on top of them.
  const order = useMemo(() => [...points].sort((a, b) => b.span_count - a.span_count), [points]);
  const orderRef = useRef(order);
  orderRef.current = order;

  const screen = (p: MapPoint, t: ZoomTransform): [number, number] => [t.applyX(p.x * WORLD), t.applyY(-p.y * WORLD)];

  const draw = () => {
    const s = scene.current;
    if (!s || s.frame !== undefined) return;
    s.frame = requestAnimationFrame(() => {
      s.frame = undefined;
      const { ctx, width, height, transform } = s;
      const { colourBy, colours, lit, selected } = props.current;
      const grow = Math.min(3, Math.max(1, Math.sqrt(transform.k / s.fitK)));
      ctx.fillStyle = BACKGROUND;
      ctx.fillRect(0, 0, width, height);
      const dot = (p: MapPoint, fill: string) => {
        const [x, y] = screen(p, transform);
        const r = pointRadius(p.span_count) * grow;
        if (x < -r || y < -r || x > width + r || y > height + r) return;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      };
      const everything = lit.size === props.current.points.length;
      if (!everything) for (const p of orderRef.current) if (!lit.has(p.session_id)) dot(p, DIM);
      ctx.globalAlpha = 0.85;
      for (const p of orderRef.current) if (lit.has(p.session_id)) dot(p, colours.colourOf(keyOf(p, colourBy)));
      ctx.globalAlpha = 1;
      for (const p of [s.hover, selected]) {
        if (!p) continue;
        const [x, y] = screen(p, transform);
        ctx.strokeStyle = "#e6e8eb";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, pointRadius(p.span_count) * grow + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  };

  const fit = () => {
    const s = scene.current;
    const z = zoomer.current;
    const canvas = canvasRef.current;
    if (!s || !z || !canvas) return;
    const { points, lit } = props.current;
    const focus = lit.size > 0 ? points.filter((p) => lit.has(p.session_id)) : points;
    const b = robustBounds(focus);
    if (!b) return;
    const spanX = Math.max(b.maxX - b.minX, 0.05) * WORLD;
    const spanY = Math.max(b.maxY - b.minY, 0.05) * WORLD;
    const k = 0.85 * Math.min(s.width / spanX, s.height / spanY);
    const cx = ((b.minX + b.maxX) / 2) * WORLD;
    const cy = (-(b.minY + b.maxY) / 2) * WORLD;
    s.fitK = k;
    select(canvas).call(z.transform, zoomIdentity.translate(s.width / 2 - k * cx, s.height / 2 - k * cy).scale(k));
  };

  const nearest = (mx: number, my: number): MapPoint | undefined => {
    const s = scene.current;
    if (!s) return undefined;
    const { points, lit } = props.current;
    let best: MapPoint | undefined;
    let bestD = HIT_RADIUS * HIT_RADIUS;
    for (const p of points) {
      if (!lit.has(p.session_id)) continue;
      const [x, y] = screen(p, s.transform);
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    scene.current = { ctx, width: 0, height: 0, transform: zoomIdentity, fitK: 1 };
    const z = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.05, 400])
      .clickDistance(4)
      .on("zoom", (e: { transform: ZoomTransform }) => {
        const s = scene.current!;
        s.transform = e.transform;
        s.hover = undefined;
        tipRef.current!.hidden = true;
        draw();
      });
    zoomer.current = z;
    select(canvas).call(z).on("dblclick.zoom", null);

    let fitted = false;
    const resize = new ResizeObserver(() => {
      const s = scene.current!;
      const dpr = devicePixelRatio || 1;
      s.width = canvas.clientWidth;
      s.height = canvas.clientHeight;
      canvas.width = Math.round(s.width * dpr);
      canvas.height = Math.round(s.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!fitted && s.width > 0) {
        fitted = true;
        fit();
      }
      draw();
    });
    resize.observe(canvas);

    const local = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const move = (e: PointerEvent) => {
      const s = scene.current!;
      const [mx, my] = local(e);
      const hit = e.buttons ? undefined : nearest(mx, my);
      if (hit !== s.hover) {
        s.hover = hit;
        canvas.style.cursor = hit ? "pointer" : "";
        draw();
      }
      const tip = tipRef.current!;
      if (hit) {
        tip.hidden = false;
        tip.style.transform = `translate(${Math.min(mx + 14, s.width - 300)}px, ${my + 14}px)`;
        tip.replaceChildren(...tooltip(hit));
      } else {
        tip.hidden = true;
      }
    };
    const leave = () => {
      scene.current!.hover = undefined;
      tipRef.current!.hidden = true;
      draw();
    };
    const click = (e: MouseEvent) => {
      const [mx, my] = local(e);
      props.current.onSelect(nearest(mx, my));
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("click", click);
    return () => {
      resize.disconnect();
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("click", click);
      select(canvas).on(".zoom", null);
      const s = scene.current;
      if (s?.frame !== undefined) cancelAnimationFrame(s.frame);
    };
  }, []);

  useEffect(draw, [points, colourBy, colours, lit, selected]);

  const onKey = (e: KeyboardEvent) => {
    const canvas = canvasRef.current;
    const z = zoomer.current;
    if (!canvas || !z) return;
    const step = 60;
    const keys: Record<string, () => void> = {
      f: fit,
      "+": () => z.scaleBy(select(canvas), 1.4),
      "=": () => z.scaleBy(select(canvas), 1.4),
      "-": () => z.scaleBy(select(canvas), 1 / 1.4),
      ArrowLeft: () => z.translateBy(select(canvas), step / scene.current!.transform.k, 0),
      ArrowRight: () => z.translateBy(select(canvas), -step / scene.current!.transform.k, 0),
      ArrowUp: () => z.translateBy(select(canvas), 0, step / scene.current!.transform.k),
      ArrowDown: () => z.translateBy(select(canvas), 0, -step / scene.current!.transform.k),
      Escape: () => props.current.onSelect(undefined),
    };
    const action = keys[e.key];
    if (action && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      action();
    }
  };

  return (
    <>
      <canvas
        class="graph"
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label={`Map of ${points.length} sessions placed by similarity. Arrow keys pan, plus and minus zoom, F fits the view.`}
        onKeyDown={onKey}
      />
      <div class="map-tip" ref={tipRef} hidden />
      <button class="map-fit" onClick={fit} title="Fit the highlighted sessions in view (F)">Fit</button>
    </>
  );
}

function tooltip(p: MapPoint): Node[] {
  const title = document.createElement("strong");
  title.textContent = titleOf(p) || "Untitled session";
  const meta = document.createElement("span");
  meta.className = "muted";
  meta.textContent = `${repoOf(p.cwd)} · ${harnessOf(p)} · ${p.span_count} spans · ${ago(p.last_seen_at)}`;
  return [title, meta];
}

function Legend({ colours, colourBy, only, setOnly }: {
  colours: Palette;
  colourBy: ColourBy;
  only?: ReadonlySet<string>;
  setOnly: (keys: Set<string> | undefined) => void;
}) {
  const otherKeys = colours.other.map(([key]) => key);
  const otherCount = colours.other.reduce((sum, [, n]) => sum + n, 0);
  const pressed = (keys: string[]) => only !== undefined && keys.every((k) => only.has(k));
  const toggle = (keys: string[], e: MouseEvent) => {
    const add = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!add) return setOnly(pressed(keys) && only!.size === keys.length ? undefined : new Set(keys));
    const next = new Set(only ?? []);
    for (const k of keys) pressed(keys) ? next.delete(k) : next.add(k);
    setOnly(next);
  };
  return (
    <div class="legend" role="group" aria-label={`Highlight by ${colourBy}`}>
      <ul>
        {colours.named.map(([key, n]) => (
          <li key={key}>
            <button type="button" aria-pressed={pressed([key])} onClick={(e) => toggle([key], e)}>
              <span class="dot" style={{ background: colours.colourOf(key) }} /><span class="key" title={key}>{key}</span> <span class="muted">{n}</span>
            </button>
          </li>
        ))}
        {otherKeys.length > 0 && (
          <li>
            <button type="button" aria-pressed={pressed(otherKeys)} onClick={(e) => toggle(otherKeys, e)}>
              <span class="dot" style={{ background: colours.colourOf(otherKeys[0]!) }} />
              {otherKeys.length} other {colourBy === "repo" ? "repos" : "harnesses"} <span class="muted">{otherCount}</span>
            </button>
          </li>
        )}
      </ul>
      <p class="muted legend-hint">
        {only ? <button type="button" class="link" onClick={() => setOnly(undefined)}>Show all</button> : "Click to highlight, shift-click to add"}
      </p>
    </div>
  );
}

function PointPanel({ point, colour, onClose }: { point: MapPoint; colour: string; onClose: () => void }) {
  return (
    <aside class="node-panel" aria-label="Selected session">
      <button class="close" onClick={onClose} aria-label="Close">×</button>
      <div class="muted">
        <span class="dot" style={{ background: colour }} />
        <span title={point.cwd}>{repoOf(point.cwd)}</span> · {harnessOf(point)}
      </div>
      <p>{titleOf(point) || "Untitled session"}</p>
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
