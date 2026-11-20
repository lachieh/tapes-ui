import { useEffect, useState } from "preact/hooks";

export type Async<T> =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "ready"; data: T };

export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[], pollMs?: number): Async<T> {
  const [result, setResult] = useState<Async<T>>({ state: "loading" });
  useEffect(() => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setResult({ state: "loading" });
    const run = async (first: boolean) => {
      if (first || !document.hidden) {
        try {
          const data = await load(ctrl.signal);
          if (!ctrl.signal.aborted) setResult({ state: "ready", data });
        } catch (err) {
          if (!ctrl.signal.aborted) setResult({ state: "error", error: (err as Error).message });
        }
      }
      if (pollMs && !ctrl.signal.aborted) timer = setTimeout(() => run(false), pollMs);
    };
    run(true);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, deps);
  return result;
}

export interface Route {
  path: string;
  params: URLSearchParams;
}

function parseHash(): Route {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path = "/", qs = ""] = raw.split("?");
  return { path, params: new URLSearchParams(qs) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function href(path: string, params: Record<string, string | number | undefined> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return `#${path}${s ? `?${s}` : ""}`;
}
