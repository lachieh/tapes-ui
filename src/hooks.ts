import { useEffect, useState } from "preact/hooks";

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
