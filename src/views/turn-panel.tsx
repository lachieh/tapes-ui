import { useQuery } from "@tanstack/preact-query";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { colour, cost, count, duration } from "../format";
import { href } from "../hooks";
import { compressedScale, threads, type Thread, type TimelineSession, type TimelineTurn, type TurnSpan } from "../timeline/data";
import { turnSpansQuery } from "../queries";
import { QueryError } from "./status";

const ROW = 18;
const LABEL = 150;
const MAX_VISIBLE_ROWS = 14;
const ERROR = "#e15759";
const MUTED = "#5b636e";
const MS = 1e6;

const muted = (s: TurnSpan) => s.call_kind.startsWith("injected") || s.call_kind.startsWith("offshoot");

export function TurnPanel({ session, turn, onClose }: { session: TimelineSession; turn: TimelineTurn; onClose: () => void }) {
  const spans = useQuery(turnSpansQuery(turn.trace_id));
  const rows = useMemo(() => (spans.data ? threads(spans.data.spans) : []), [spans.data]);
  return (
    <section class="tl-panel" aria-label="Turn detail">
      <header class="tl-panel-head">
        <div>
          <p class="tl-prompt">{turn.prompt || (turn.synthetic ? "Synthetic turn" : "No prompt")}</p>
          <span class="muted">
            {new Date(turn.started).toLocaleString()} · {duration((turn.ended - turn.started) * MS)} · {cost(turn.cost_usd)} ·{" "}
            {count(turn.input_tokens)} in / {count(turn.output_tokens)} out · {turn.span_count} spans
            {rows.length > 1 && ` · ${rows.length - 1} subagent threads`}
            {turn.error_span_count > 0 && <span class="error"> · {turn.error_span_count} errors</span>}
          </span>
        </div>
        <span class="tl-panel-actions">
          <a href={href("/session", { id: session.session_id, turn: turn.trace_id })}>Open in session</a>
          <button class="close" onClick={onClose} aria-label="Close turn">×</button>
        </span>
      </header>
      {spans.isPending && <p class="muted">Loading spans…</p>}
      {spans.error && <QueryError error={spans.error} retry={() => spans.refetch()} />}
      {spans.data && rows.length > 0 && <Gantt rows={rows} />}
      {spans.data && (
        <ul class="tl-key muted" aria-label="Span key">
          {(["llm", "tool", "event"] as const).map((k) => <li><span class="dot" style={{ background: colour(k) }} />{k}</li>)}
          <li><span class="dot" style={{ background: MUTED }} />injected</li>
          <li><span class="dot tl-key-error" />error</li>
          <li><span class="tl-key-gap" />idle time skipped</li>
        </ul>
      )}
    </section>
  );
}

function Gantt({ rows }: { rows: Thread[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ span: TurnSpan; x: number; y: number }>();
  const height = rows.length * ROW + 8;

  const scale = useMemo(() => {
    const all = rows.flatMap((r) => [...r.spans, ...(r.agent ? [r.agent] : [])]);
    const t0 = Math.min(...all.map((s) => s.started));
    const t1 = Math.max(...all.map((s) => s.ended));
    // Skip idle stretches longer than a minute, or 2% of the turn if that is longer.
    const maxGap = Math.max(60_000, (t1 - t0) * 0.02);
    return compressedScale(all.map((s) => ({ since: s.started, until: s.ended })), Math.max(0, width - LABEL - 8), maxGap);
  }, [rows, width]);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const x = (t: number) => LABEL + scale.x(t);
    const mid = (i: number) => 4 + i * ROW + ROW / 2;

    ctx.fillStyle = "rgba(255,255,255,0.03)";
    for (const seg of scale.segments) if (seg.gap) ctx.fillRect(LABEL + seg.x0, 0, seg.x1 - seg.x0, height);

    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    rows.forEach((row, i) => {
      ctx.fillStyle = "#8b939e";
      ctx.fillText(i === 0 ? "main" : `subagent ${row.id.slice(0, 7)}`, 6, mid(i));
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(LABEL, mid(i));
      ctx.lineTo(width, mid(i));
      ctx.stroke();
    });

    // Where each subagent thread branches off the main line and rejoins it.
    rows.forEach((row, i) => {
      if (i === 0 || !row.agent) return;
      ctx.strokeStyle = colour("agent");
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x(row.agent.started), mid(0));
      ctx.lineTo(x(row.agent.started), mid(i));
      ctx.lineTo(x(row.agent.ended), mid(i));
      ctx.lineTo(x(row.agent.ended), mid(0));
      ctx.stroke();
      ctx.setLineDash([]);
    });

    rows.forEach((row, i) => {
      for (const s of row.spans) {
        const sx = x(s.started);
        const w = Math.max(s.kind === "event" ? 1 : 2, x(s.ended) - sx);
        const h = s.kind === "event" ? 6 : s.kind === "llm" ? 10 : 8;
        ctx.fillStyle = muted(s) ? MUTED : colour(s.kind);
        ctx.fillRect(sx, mid(i) - h / 2, w, h);
        if (s.status === "error") {
          ctx.strokeStyle = ERROR;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(sx - 1, mid(i) - h / 2 - 1, w + 2, h + 2);
          ctx.lineWidth = 1;
        }
      }
    });
  }, [rows, width, height, scale]);

  const onMove = (e: PointerEvent) => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const i = Math.floor((my - 4) / ROW);
    const row = rows[i];
    if (!row || mx < LABEL) return setHover(undefined);
    let best: TurnSpan | undefined;
    let bestD = 6;
    for (const s of row.spans) {
      const x0 = LABEL + scale.x(s.started);
      const x1 = Math.max(x0 + 2, LABEL + scale.x(s.ended));
      const d = mx < x0 ? x0 - mx : mx > x1 ? mx - x1 : 0;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    setHover(best ? { span: best, x: e.clientX, y: e.clientY } : undefined);
  };

  return (
    <div class="tl-gantt" ref={wrap} style={{ maxHeight: MAX_VISIBLE_ROWS * ROW + 8 }}>
      <canvas ref={canvasRef} style={{ width: "100%", height }} onPointerMove={onMove} onPointerLeave={() => setHover(undefined)} aria-label={`${rows.length} threads of spans`} role="img" />
      {hover && (
        <div class="map-tip tl-tip" style={{ position: "fixed", transform: `translate(${Math.min(hover.x + 14, innerWidth - 320)}px, ${hover.y + 14}px)` }}>
          <strong>{hover.span.kind} · {hover.span.name}</strong>
          <span class="muted">
            {duration((hover.span.ended - hover.span.started) * MS)}
            {hover.span.model && ` · ${hover.span.model}`}
            {hover.span.input_tokens + hover.span.output_tokens > 0 && ` · ${count(hover.span.input_tokens)} in / ${count(hover.span.output_tokens)} out`}
          </span>
          {(hover.span.call_kind || hover.span.status !== "ok") && (
            <span class={hover.span.status === "error" ? "error" : "muted"}>{[hover.span.call_kind, hover.span.status].filter(Boolean).join(" · ")}</span>
          )}
        </div>
      )}
    </div>
  );
}
