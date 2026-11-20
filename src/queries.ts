import { infiniteQueryOptions, QueryClient, queryOptions } from "@tanstack/preact-query";
import { api, ApiError, sessionTracesUpTo, type SessionTraces } from "./api";
import type { MapPoints } from "./map/embedding";

const MINUTE = 60_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Keep results for half an hour after the last page that used them unmounts,
      // so returning to a page shows its data at once and refreshes behind it.
      gcTime: 30 * MINUTE,
      retry: (failures, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && failures < 2,
    },
  },
});

export const statsQuery = queryOptions({
  queryKey: ["stats"],
  queryFn: ({ signal }) => api.stats(signal),
  refetchInterval: MINUTE,
});

export const sessionsQuery = (sort: string) =>
  infiniteQueryOptions({
    queryKey: ["sessions", sort],
    queryFn: ({ pageParam, signal }) => api.sessions({ limit: 50, sort, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor,
    refetchInterval: 15_000,
  });

export const sessionTracesQuery = (id: string) =>
  queryOptions({
    queryKey: ["session", id, "traces"],
    queryFn: ({ signal }) => api.sessionTraces(id, { limit: 200 }, signal),
    refetchInterval: 20_000,
  });

export const spanQuery = (traceId: string, spanId: string) =>
  queryOptions({
    queryKey: ["span", traceId, spanId],
    queryFn: ({ signal }) => api.span(traceId, spanId, signal),
    staleTime: Infinity,
  });

export const searchQuery = (query: string) =>
  queryOptions({
    queryKey: ["search", query],
    queryFn: ({ signal }) => api.search(query, 25, signal),
    enabled: query !== "",
    staleTime: 5 * MINUTE,
  });

export type PointsResult = { state: "computing" } | { state: "not-installed" } | { state: "ready"; data: MapPoints };

export const mapPointsQuery = queryOptions({
  queryKey: ["map", "points"],
  queryFn: async ({ signal }): Promise<PointsResult> => {
    try {
      return { state: "ready", data: await api.mapPoints(signal) };
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) return { state: "computing" };
      if (err instanceof ApiError && err.status === 404) return { state: "not-installed" };
      throw err;
    }
  },
  // The cassette recomputes hourly; the HTTP cache revalidates with its ETag.
  staleTime: 5 * MINUTE,
  gcTime: 60 * MINUTE,
  refetchInterval: (query) => (query.state.data?.state === "computing" ? 10_000 : false),
});

export const sessionMapQuery = (ids: { session?: string; sessions: number; turns: number }, onProgress: (n: number, of: number) => void) =>
  queryOptions({
    queryKey: ["map", "structure", ids.session ?? null, ids.sessions, ids.turns],
    queryFn: ({ signal }) => loadSessionMap(ids, signal, onProgress),
    staleTime: 5 * MINUTE,
  });

const MAX_SESSION_PAGES = 10;
const CONCURRENT_SESSION_LOADS = 4;

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

async function loadSessionMap(
  opts: { session?: string; sessions: number; turns: number },
  signal: AbortSignal,
  progress: (n: number, of: number) => void,
): Promise<SessionTraces[]> {
  const ids = opts.session ? [opts.session] : await recentSessionsWithTurns(opts.sessions, signal);
  const out: SessionTraces[] = [];
  for (let i = 0; i < ids.length; i += CONCURRENT_SESSION_LOADS) {
    const batch = await Promise.all(ids.slice(i, i + CONCURRENT_SESSION_LOADS).map((id) => sessionTracesUpTo(id, opts.turns, signal)));
    out.push(...batch);
    progress(out.length, ids.length);
  }
  return out;
}
