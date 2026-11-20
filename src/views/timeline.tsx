import { useQuery } from "@tanstack/preact-query";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { colour, cost, count, duration } from "../format";
import { href } from "../hooks";
import {
  isTinySession, laneGroups, nights, RANGES, sessionTitle, ticks, TINY_SESSION_SPANS, type Lane, type LaneGroup, type RangeKey, type Timeline, type TimelineSession,
  type TimelineTurn,
} from "../timeline/data";
import { sessionQuery, timelineQuery, type TimelineWindow } from "../queries";
import { QueryError } from "./status";
import { TurnPanel } from "./turn-panel";

const ROW = 26;
const ERROR = "#e15759";
// Turns stay neutral so red errors stand out; the lane line and dot carry the harness colour.
const TURN = "#b9c2cd";
const MS = 1e6;

const fmtTime = (t: number, span: number) =>
  new Date(t).toLocaleString(undefined, span > 36 * 3600_000
    ? { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" });

const fmtWindow = (since: number, until: number) => {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric", minute: "2-digit" };
  return `${new Date(since).toLocaleString(undefined, opts)} – ${new Date(until).toLocaleString(undefined, opts)}`;
};

function parseWindow(params: URLSearchParams): { range: RangeKey; window: TimelineWindow } | undefined {
  const range = (params.get("range") ?? "24h") as RangeKey;
  const length = RANGES[range] ?? RANGES["24h"];
  const since = Date.parse(params.get("since") ?? "");
  const until = Date.parse(params.get("until") ?? "");
  if (Number.isFinite(since) && Number.isFinite(until) && since < until) return { range, window: { since, until } };
  return { range: range in RANGES ? range : "24h", window: { length } };
}

export function TimelineView({ params, layoutSwitch }: { params: URLSearchParams; layoutSwitch: ComponentChildren }) {
  const focus = params.get("focus") ?? undefined;
  const turnParam = params.get("turn") ?? undefined;
  const text = params.get("q") ?? "";
  const showTiny = params.get("all") === "1";
  const set = (changes: Record<string, string | undefined>) => {
    location.hash = href("/map", { ...Object.fromEntries(params), ...changes });
  };

  // A focused session with no explicit window opens on the session itself.
  const needsFocusWindow = focus !== undefined && !params.get("since");
  const focused = useQuery({ ...sessionQuery(focus ?? ""), enabled: needsFocusWindow });
  useEffect(() => {
    if (!needsFocusWindow || !focused.data) return;
    const s = Date.parse(focused.data.started_at);
    const e = Math.max(Date.parse(focused.data.last_seen_at), s + 60_000);
    const pad = (e - s) * 0.05;
    location.replace(href("/map", { ...Object.fromEntries(params), since: new Date(s - pad).toISOString(), until: new Date(e + pad).toISOString() }));
  }, [needsFocusWindow, focused.data]);

  const { range, window } = parseWindow(params)!;
  const fixed = window.until !== undefined;
  const data = useQuery({ ...timelineQuery(window), enabled: !needsFocusWindow });
  const tinyCount = useMemo(() => data.data?.sessions.filter(isTinySession).length ?? 0, [data.data]);
  const timeline = useMemo(
    () => (data.data && !showTiny ? { ...data.data, sessions: data.data.sessions.filter((s) => !isTinySession(s)) } : data.data),
    [data.data, showTiny],
  );

  const shift = (direction: -1 | 1) => {
    const until = fixed ? window.until : Date.now();
    const since = fixed ? window.since : until - window.length;
    const step = (until - since) * direction;
    const nextUntil = until + step;
    if (nextUntil >= Date.now()) return set({ since: undefined, until: undefined, range: rangeFor(until - since) });
    set({ since: new Date(since + step).toISOString(), until: new Date(nextUntil).toISOString() });
  };

  return (
    <div class="map-page">
      <div class="toolbar map-toolbar">
        {layoutSwitch}
        <span class="segmented" role="group" aria-label="Time range">
          {(Object.keys(RANGES) as RangeKey[]).map((key) => (
            <a href={href("/map", { range: key === "24h" ? undefined : key, q: text || undefined })} aria-current={!fixed && range === key ? "true" : undefined}>{key}</a>
          ))}
        </span>
        <span class="segmented" role="group" aria-label="Move window">
          <button type="button" onClick={() => shift(-1)} aria-label="Earlier">‹ Earlier</button>
          <button type="button" onClick={() => shift(1)} disabled={!fixed} aria-label="Later">Later ›</button>
        </span>
        <input
          type="search"
          aria-label="Highlight sessions by title, directory or prompt"
          placeholder="Highlight title, directory or prompt"
          value={text}
          onChange={(e) => set({ q: e.currentTarget.value || undefined })}
        />
        <label title={`Sessions with one turn of ${TINY_SESSION_SPANS} spans or fewer (or under 30 seconds when spans are not counted yet), such as title and branch-name generators`}>
          <input type="checkbox" checked={showTiny} onChange={(e) => set({ all: e.currentTarget.checked ? "1" : undefined })} /> Tiny sessions{" "}
          {data.data && <span class="muted">{tinyCount}</span>}
        </label>
        <span class="toolbar-status muted" aria-live="polite">
          {(data.isPending || needsFocusWindow) && "Loading timeline…"}
          {timeline && (
            <>
              {timeline.sessions.length} sessions · {fmtWindow(timeline.since, timeline.until)}
              {timeline.truncated && " · showing the most recent 400"}
              {data.isFetching && " · refreshing"}
            </>
          )}
        </span>
      </div>
      {data.error && <div class="page"><QueryError error={data.error} retry={() => data.refetch()} /></div>}
      {timeline && timeline.sessions.length === 0 && (
        <p class="page muted">No sessions were active in this window. <button class="link" onClick={() => shift(-1)}>Look earlier</button></p>
      )}
      {timeline && timeline.sessions.length > 0 && (
        <Lanes
          timeline={timeline}
          text={text}
          focus={focus}
          openTurn={turnParam}
          onTurn={(trace) => set({ turn: trace === turnParam ? undefined : trace })}
          onZoom={(since, until) => set({ since: new Date(since).toISOString(), until: new Date(until).toISOString() })}
        />
      )}
    </div>
  );
}

const rangeFor = (ms: number): string | undefined => {
  const match = (Object.entries(RANGES) as [RangeKey, number][]).find(([, v]) => v === ms);
  return match && match[0] !== "24h" ? match[0] : undefined;
};

interface TipState {
  x: number;
  y: number;
  body: ComponentChildren;
}

function matches(s: TimelineSession, needle: string): boolean {
  if (!needle) return true;
  return [s.title, s.cwd, ...s.turns.map((t) => t.prompt)].some((v) => v.toLowerCase().includes(needle));
}

function Lanes({ timeline, text, focus, openTurn, onTurn, onZoom }: {
  timeline: Timeline;
  text: string;
  focus?: string;
  openTurn?: string;
  onTurn: (traceId: string) => void;
  onZoom: (since: number, until: number) => void;
}) {
  const groups = useMemo(() => laneGroups(timeline.sessions), [timeline]);
  const body = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState<TipState>();
  const [brush, setBrush] = useState<{ x0: number; x1: number }>();
  const needle = text.trim().toLowerCase();
  const { since, until } = timeline;
  const x = (t: number) => ((t - since) / (until - since)) * width;
  const maxCost = useMemo(() => Math.max(0.0001, ...timeline.sessions.flatMap((s) => s.turns.map((t) => t.cost_usd))), [timeline]);

  useEffect(() => {
    const el = body.current!;
    const track = () => el.querySelector<HTMLElement>(".tl-axis-track");
    const measure = () => setWidth(track()?.clientWidth ?? 0);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!focus) return;
    body.current?.querySelector(`[data-session="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: "center" });
  }, [focus, groups]);

  // Drag across the tracks to zoom into that stretch of time.
  const trackLeft = () => body.current!.querySelector<HTMLElement>(".tl-axis-track")!.getBoundingClientRect().left;
  const onPointerDown = (e: PointerEvent) => {
    const target = e.target as Element;
    if (e.button !== 0 || target.closest("[data-turn]") || !target.closest(".tl-track")) return;
    const left = trackLeft();
    const x0 = e.clientX - left;
    setBrush({ x0, x1: x0 });
    const move = (m: PointerEvent) => setBrush({ x0, x1: Math.max(0, Math.min(width, m.clientX - left)) });
    const up = (u: PointerEvent) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      setBrush(undefined);
      const x1 = Math.max(0, Math.min(width, u.clientX - left));
      if (Math.abs(x1 - x0) < 8 || width === 0) return;
      const t = (px: number) => since + (px / width) * (until - since);
      onZoom(t(Math.min(x0, x1)), t(Math.max(x0, x1)));
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  const showTip = (e: MouseEvent, content: ComponentChildren) => setTip({ x: e.clientX, y: e.clientY, body: content });
  const now = Date.now();

  return (
    <div class="tl-body" ref={body} onPointerDown={onPointerDown} onPointerLeave={() => setTip(undefined)}>
      <div class="tl-axis">
        <div class="tl-label muted">{groups.reduce((n, g) => n + g.lanes.length, 0)} sessions in {groups.length} repos</div>
        <div class="tl-axis-track">
          {width > 0 && (
            <svg width={width} height={24} aria-hidden="true">
              {ticks(since, until, Math.max(3, Math.floor(width / 110))).map((t) => (
                <g transform={`translate(${x(t)},0)`}>
                  <line y1={16} y2={24} stroke="var(--line)" />
                  <text y={12} text-anchor={x(t) < 40 ? "start" : x(t) > width - 40 ? "end" : "middle"} class="tl-tick">{fmtTime(t, until - since)}</text>
                </g>
              ))}
            </svg>
          )}
        </div>
      </div>
      <div class="tl-rows">
        {width > 0 && (
          <svg class="tl-grid" width={width} aria-hidden="true">
            {nights(since, until).map((n) => <rect x={x(n.since)} width={x(n.until) - x(n.since)} y={0} height="100%" class="tl-night" />)}
            {ticks(since, until, Math.max(3, Math.floor(width / 110))).map((t) => <line x1={x(t)} x2={x(t)} y1={0} y2="100%" class="tl-gridline" />)}
            {now > since && now < until && <line x1={x(now)} x2={x(now)} y1={0} y2="100%" class="tl-now" />}
          </svg>
        )}
        {groups.map((g) => (
          <Group
            group={g}
            width={width}
            x={x}
            maxCost={maxCost}
            needle={needle}
            focus={focus}
            openTurn={openTurn}
            onTurn={onTurn}
            showTip={showTip}
            hideTip={() => setTip(undefined)}
          />
        ))}
        {brush && <div class="tl-brush" style={{ left: `calc(var(--tl-label) + ${Math.min(brush.x0, brush.x1)}px)`, width: Math.abs(brush.x1 - brush.x0) }} />}
      </div>
      {tip && (
        <div class="map-tip tl-tip" style={{ transform: `translate(${Math.min(tip.x + 14, innerWidth - 320)}px, ${tip.y + 14}px)` }}>
          {tip.body}
        </div>
      )}
    </div>
  );
}

function Group({ group, width, x, maxCost, needle, focus, openTurn, onTurn, showTip, hideTip }: {
  group: LaneGroup;
  width: number;
  x: (t: number) => number;
  maxCost: number;
  needle: string;
  focus?: string;
  openTurn?: string;
  onTurn: (traceId: string) => void;
  showTip: (e: MouseEvent, body: ComponentChildren) => void;
  hideTip: () => void;
}) {
  const total = group.lanes.reduce((sum, l) => sum + l.session.cost_usd, 0);
  return (
    <section class="tl-group" aria-label={group.repo}>
      <h3 class="tl-group-head">
        <span>{group.repo}</span> <span class="muted">{group.lanes.length} · {cost(total)}</span>
      </h3>
      {group.lanes.map((lane) => {
        const open = lane.session.turns.find((t) => t.trace_id === openTurn);
        return (
          <>
            <LaneRow
              lane={lane}
              width={width}
              x={x}
              maxCost={maxCost}
              dim={!matches(lane.session, needle)}
              focused={lane.session.session_id === focus}
              openTurn={openTurn}
              onTurn={onTurn}
              showTip={showTip}
              hideTip={hideTip}
            />
            {open && <TurnPanel session={lane.session} turn={open} onClose={() => onTurn(open.trace_id)} />}
          </>
        );
      })}
    </section>
  );
}

function LaneRow({ lane, width, x, maxCost, dim, focused, openTurn, onTurn, showTip, hideTip }: {
  lane: Lane;
  width: number;
  x: (t: number) => number;
  maxCost: number;
  dim: boolean;
  focused: boolean;
  openTurn?: string;
  onTurn: (traceId: string) => void;
  showTip: (e: MouseEvent, body: ComponentChildren) => void;
  hideTip: () => void;
}) {
  const s = lane.session;
  const hue = colour(s.harness_id);
  const mid = ROW / 2;
  const x0 = Math.max(0, x(s.started));
  const x1 = Math.min(width, Math.max(x(s.last_seen), x0 + 2));
  const indent = lane.depth * 14;
  const title = sessionTitle(s);
  return (
    <div class={`tl-row${dim ? " dim" : ""}${focused ? " focused" : ""}`} data-session={s.session_id}>
      <div class="tl-label" style={{ paddingLeft: `calc(0.75rem + ${indent}px)` }}>
        {lane.depth > 0 && <span class="tl-branch" aria-hidden="true" />}
        <span class="dot" style={{ background: hue }} />
        <a href={href("/session", { id: s.session_id })} title={`${title || "Untitled session"}\n${s.cwd}`} class={title ? "" : "muted"}>
          {title || "Untitled session"}
        </a>
      </div>
      <div class="tl-track">
        {width > 0 && (
          <svg width={width} height={ROW} role="group" aria-label={`${title || "Untitled session"}: ${s.turns.length} turns in view`}>
            {lane.depth > 0 && x(s.started) >= 0 && (
              <path d={`M${x(s.started)},${-ROW / 2} V${mid} H${x(s.started) + 4}`} class="tl-hang" stroke={hue} />
            )}
            <line x1={x0} x2={x1} y1={mid} y2={mid} stroke={hue} class="tl-life" />
            {s.turns.map((t) => {
              const tx = x(t.started);
              const w = Math.max(3, x(t.ended) - tx);
              const h = 6 + 12 * Math.sqrt(Math.max(0, t.cost_usd) / maxCost);
              const error = t.status === "error";
              return (
                <>
                <rect
                  data-turn={t.trace_id}
                  x={tx}
                  y={mid - h / 2}
                  width={w}
                  height={h}
                  rx={1.5}
                  fill={t.synthetic ? "none" : error ? ERROR : TURN}
                  stroke={t.trace_id === openTurn ? "var(--accent)" : t.synthetic ? TURN : "none"}
                  stroke-width={t.trace_id === openTurn || error ? 1.5 : 1}
                  class="tl-turn"
                  tabIndex={0}
                  role="button"
                  aria-label={`Turn at ${new Date(t.started).toLocaleTimeString()}: ${t.prompt || "no prompt"}`}
                  aria-expanded={t.trace_id === openTurn}
                  onClick={() => onTurn(t.trace_id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onTurn(t.trace_id))}
                  onPointerMove={(e) => showTip(e, <TurnTip session={s} turn={t} />)}
                  onPointerLeave={hideTip}
                />
                {!error && (t.error_span_count ?? 0) > 0 && <circle cx={tx + w} cy={mid - h / 2 - 1} r={1.75} fill={ERROR} aria-hidden="true" />}
                </>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

function TurnTip({ session, turn }: { session: TimelineSession; turn: TimelineTurn }) {
  return (
    <>
      <strong>{turn.prompt || (turn.synthetic ? "Synthetic turn" : "No prompt")}</strong>
      <span class="muted">
        {new Date(turn.started).toLocaleTimeString()} · {duration((turn.ended - turn.started) * MS)} · {cost(turn.cost_usd)} ·{" "}
        {count(turn.input_tokens + turn.output_tokens)} tokens
      </span>
      <span class="muted">
        {turn.span_count === undefined ? "spans not counted yet" : `${turn.span_count} spans`}
        {(turn.error_span_count ?? 0) > 0 && <span class="error"> · {turn.error_span_count} errors</span>} · {session.harness_id}
      </span>
    </>
  );
}
