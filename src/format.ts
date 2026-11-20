export const shortId = (id: string) => id.slice(0, 8);

export function cost(usd: number | undefined): string {
  const n = usd ?? 0;
  return n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(n >= 1 ? 2 : 4)}`;
}

export function count(n: number | undefined): string {
  const v = n ?? 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(v);
}

export function duration(ns: number | undefined): string {
  const s = (ns ?? 0) / 1e9;
  if (s < 1) return `${Math.round(s * 1000)}ms`;
  if (s < 60) return `${s.toFixed(1)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
}

export function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function basename(path: string | undefined): string {
  if (!path) return "";
  return path.replace(/\/+$/, "").split("/").pop() ?? path;
}

// Stable colour per group key, so a harness or span kind keeps its colour
// across pages and reloads.
const PALETTE = ["#4e9af1", "#f28e2b", "#59a14f", "#e15759", "#b07aa1", "#76b7b2", "#edc948", "#ff9da7", "#9c755f", "#bab0ac"];
const FIXED: Record<string, string> = {
  session: "#e8e8e8", ok: "#59a14f", error: "#e15759",
  llm: "#4e9af1", tool: "#f28e2b", agent: "#b07aa1", event: "#76b7b2",
};
export function colour(key: string): string {
  const fixed = FIXED[key];
  if (fixed) return fixed;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}
