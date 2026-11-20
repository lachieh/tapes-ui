import { useInfiniteQuery, useQuery } from "@tanstack/preact-query";
import { useState } from "preact/hooks";
import { firstOccurrenceById } from "../api";
import { ago, colour, cost, count, duration, shortId } from "../format";
import { href } from "../hooks";
import { repoOf } from "../map/embedding";
import { sessionsQuery, sessionTracesQuery, spanQuery, statsQuery } from "../queries";
import { QueryError } from "./status";

const SORTS = ["last_active", "started_at", "turn_count", "total_cost_usd", "total_tokens"] as const;

export function Sessions({ sort }: { sort: string }) {
  const sessions = useInfiniteQuery(sessionsQuery(sort));
  const stats = useQuery(statsQuery);
  const items = firstOccurrenceById(sessions.data?.pages.flatMap((page) => page.items) ?? []);

  return (
    <div class="page">
      {stats.data && (
        <div class="stats">
          <Stat label="sessions" value={count(stats.data.session_count)} />
          <Stat label="turns" value={count(stats.data.turn_count)} />
          <Stat label="tool calls" value={count(stats.data.tool_calls)} />
          <Stat label="tokens in / out" value={`${count(stats.data.input_tokens)} / ${count(stats.data.output_tokens)}`} />
          <Stat label="cost" value={cost(stats.data.total_cost)} />
        </div>
      )}
      <div class="toolbar">
        <label>
          Sort{" "}
          <select value={sort} onChange={(e) => (location.hash = href("/", { sort: e.currentTarget.value }))}>
            {SORTS.map((s) => <option value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <span class="muted">Refreshes every 15s</span>
      </div>
      {sessions.isPending && <p class="muted">Loading sessions…</p>}
      {sessions.error && <QueryError error={sessions.error} retry={() => sessions.refetch()} />}
      <table class="sessions">
        <thead>
          <tr><th>Session</th><th>Harness</th><th>Repo</th><th>Turns</th><th>Tokens</th><th>Cost</th><th>Last seen</th></tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id}>
              <td class="title">
                {s.live && <span class="live" title="live" />}
                <a href={href("/session", { id: s.id })}>{s.display_title || s.rollup.preview || shortId(s.id)}</a>
                <span class={`badge ${s.rollup.status}`}>{s.rollup.status}</span>
              </td>
              <td><span class="dot" style={{ background: colour(s.harness_id) }} />{s.harness_id}</td>
              <td title={s.cwd}>{s.cwd ? repoOf(s.cwd) : ""}</td>
              <td class="num">{s.rollup.turn_count}</td>
              <td class="num">{count((s.rollup.usage.input_tokens ?? 0) + (s.rollup.usage.output_tokens ?? 0))}</td>
              <td class="num">{cost(s.rollup.usage.cost_usd)}</td>
              <td title={s.last_seen_at}>{ago(s.last_seen_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sessions.hasNextPage && (
        <button onClick={() => sessions.fetchNextPage()} disabled={sessions.isFetchingNextPage}>
          {sessions.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div class="stat"><b>{value}</b><span>{label}</span></div>;
}

export function SessionDetail({ id, turn }: { id: string; turn?: string }) {
  const data = useQuery(sessionTracesQuery(id));
  const [spanRef, setSpanRef] = useState<{ traceId: string; spanId: string }>();
  const span = useQuery({ ...spanQuery(spanRef?.traceId ?? "", spanRef?.spanId ?? ""), enabled: spanRef !== undefined });

  if (data.isPending) return <p class="page muted">Loading session…</p>;
  if (data.error) return <div class="page"><QueryError error={data.error} retry={() => data.refetch()} /></div>;
  const { session, traces, next_cursor } = data.data;
  const selected = traces.find((t) => t.trace.trace_id === turn) ?? traces[0];

  return (
    <div class="page">
      <header class="session-head">
        <h2>{session.display_title || shortId(session.id)}</h2>
        <div class="muted">
          {session.harness_id} {session.harness_version} · {session.auth_subject} · <span title={session.cwd}>{session.cwd}</span>
        </div>
        <div class="muted">
          {session.rollup.turn_count} turns · {cost(session.rollup.usage.cost_usd)} · started {ago(session.started_at)}
          {session.live && " · live"} · <a href={href("/map", { session: session.id })}>view on the map</a>
        </div>
      </header>
      {traces.length === 0 && <p class="muted">No turns derived for this session yet.</p>}
      <div class="split">
        <ol class="turns">
          {traces.map(({ trace }, i) => (
            <li key={trace.trace_id} class={trace === selected?.trace ? "active" : ""}>
              <a href={href("/session", { id, turn: trace.trace_id })} onClick={() => setSpanRef(undefined)}>
                <span class="prompt">#{i + 1} {trace.user_prompt || "(synthetic turn)"}</span>
                <span class="response">{trace.response_preview}</span>
                <span class="muted">
                  {trace.status} · {trace.span_count} spans · {duration(trace.duration_ns)} · {cost(trace.usage?.cost_usd)}
                </span>
              </a>
            </li>
          ))}
          {next_cursor && <li class="muted">Showing the first {traces.length} turns.</li>}
        </ol>
        {selected && (
          <div class="spans">
            <h3>Spans</h3>
            <ul>
              {selected.spans.map((sp) => (
                <li key={sp.span_id} style={{ paddingLeft: sp.parent_span_id ? "1.25rem" : 0 }}>
                  <button class="link" onClick={() => setSpanRef({ traceId: sp.trace_id, spanId: sp.span_id })}>
                    <span class="dot" style={{ background: colour(sp.kind) }} />
                    {sp.kind} · {sp.model || sp.name}
                  </button>
                  <span class="muted"> {duration(sp.duration_ns)} {sp.status !== "ok" && sp.status}</span>
                </li>
              ))}
            </ul>
            {span.isFetching && !span.data && <p class="muted">Loading span…</p>}
            {span.error && <QueryError error={span.error} retry={() => span.refetch()} />}
            {span.data && (
              <>
                <h3>{span.data.kind} · {span.data.name}</h3>
                <pre>{JSON.stringify({ input: span.data.input, output: span.data.output, usage: span.data.usage }, null, 2)}</pre>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
