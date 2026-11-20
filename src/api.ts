// Typed client for the tapes read API. Only the fields the UI reads are
// declared; the live contract is served at /openapi.

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
}

export interface Rollup {
  status: string;
  preview?: string;
  turn_count: number;
  usage: Usage;
}

export interface Session {
  id: string;
  harness_id: string;
  cwd?: string;
  harness_version?: string;
  started_at: string;
  last_seen_at: string;
  auth_subject?: string;
  display_title?: string;
  live: boolean;
  rollup: Rollup;
}

export interface Trace {
  trace_id: string;
  user_prompt?: string;
  response_preview?: string;
  status: string;
  started_at: string;
  duration_ns?: number;
  span_count: number;
  usage?: Usage;
}

export interface Span {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  kind: string;
  name: string;
  status: string;
  started_at: string;
  duration_ns?: number;
  model?: string;
  usage?: Usage;
  input?: unknown[];
  output?: unknown[];
}

export interface SpanLink {
  kind: string;
  from_trace_id: string;
  from_span_id: string;
  to_trace_id: string;
  to_span_id: string;
}

export interface TraceDetail {
  trace: Trace;
  spans: Span[];
}

export interface SessionTraces {
  session: Session;
  traces: TraceDetail[];
  links?: SpanLink[];
  next_cursor?: string;
}

export interface Page<T> {
  items: T[];
  next_cursor?: string;
}

export interface Stats {
  session_count: number;
  turn_count: number;
  total_cost: number;
  input_tokens: number;
  output_tokens: number;
  tool_calls: number;
}

export interface SearchResult {
  trace_id: string;
  span_id: string;
  session_id: string;
  score: number;
  user_prompt?: string;
  snippet?: string;
  model?: string;
  started_at: string;
  cwd?: string;
  harness_id?: string;
  display_title?: string;
}

type Query = Record<string, string | number | boolean | undefined>;

function url(path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function getJSON<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url(path, query), { signal, headers: { accept: "application/json" } });
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const message = (body as { error?: string } | undefined)?.error;
    throw new Error(message ?? `${res.status} ${res.statusText}`);
  }
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  stats: (signal?: AbortSignal) => getJSON<Stats>("/v1/stats", {}, signal),
  sessions: (query: { limit?: number; cursor?: string; sort?: string; auth_subject?: string }, signal?: AbortSignal) =>
    getJSON<Page<Session>>("/v1/sessions", query, signal),
  sessionTraces: (id: string, query: { cursor?: string; limit?: number }, signal?: AbortSignal) =>
    getJSON<SessionTraces>(`/v1/sessions/${enc(id)}/traces`, { payload: "preview", ...query }, signal),
  span: (traceId: string, spanId: string, signal?: AbortSignal) =>
    getJSON<Span>(`/v1/traces/${enc(traceId)}/spans/${enc(spanId)}`, {}, signal),
  search: (query: string, topK: number, signal?: AbortSignal) =>
    getJSON<{ results: SearchResult[] }>("/v1/cassettes/search/spans", { query, top_k: topK }, signal),
};

// Read up to maxTraces of a session's turns, following next_cursor.
export async function sessionTracesUpTo(id: string, maxTraces: number, signal?: AbortSignal): Promise<SessionTraces> {
  let page = await api.sessionTraces(id, { limit: Math.min(maxTraces, 200) }, signal);
  const traces = [...page.traces];
  const links = [...(page.links ?? [])];
  while (page.next_cursor && traces.length < maxTraces) {
    page = await api.sessionTraces(id, { cursor: page.next_cursor, limit: Math.min(maxTraces - traces.length, 200) }, signal);
    traces.push(...page.traces);
    links.push(...(page.links ?? []));
  }
  return { session: page.session, traces: traces.slice(0, maxTraces), links, next_cursor: page.next_cursor };
}
