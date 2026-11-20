import { infiniteQueryOptions, keepPreviousData, QueryClient, queryOptions } from "@tanstack/preact-query";
import { api, ApiError } from "./api";
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

export const searchQuery = (query: string, topK = 25) =>
  queryOptions({
    queryKey: ["search", query, topK],
    queryFn: ({ signal }) => api.search(query, topK, signal),
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

export const sessionQuery = (id: string) =>
  queryOptions({
    queryKey: ["session", id],
    queryFn: ({ signal }) => api.session(id, signal),
    staleTime: MINUTE,
  });

/** A window either ends now and follows the clock, or is fixed. */
export type TimelineWindow = { length: number; until?: undefined } | { since: number; until: number };

export const timelineQuery = (w: TimelineWindow) => {
  const live = w.until === undefined;
  return queryOptions({
    queryKey: live ? ["timeline", "live", w.length] : ["timeline", w.since, w.until],
    queryFn: ({ signal }) => {
      const until = live ? Date.now() : w.until;
      const since = live ? until - w.length : w.since;
      return api.timeline(new Date(since).toISOString(), new Date(until).toISOString(), signal);
    },
    staleTime: live ? 15_000 : 10 * MINUTE,
    refetchInterval: live ? 30_000 : false,
    placeholderData: keepPreviousData,
  });
};

export const turnSpansQuery = (traceId: string) =>
  queryOptions({
    queryKey: ["timeline", "turn", traceId],
    queryFn: ({ signal }) => api.turnSpans(traceId, signal),
    staleTime: MINUTE,
  });
