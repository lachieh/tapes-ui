#!/usr/bin/env node
// Writes a synthetic /v1/cassettes/map/points response for TAPES_MAP_FIXTURE.
// Usage: node scripts/map-fixture.mjs [count] > /tmp/map-points.json
import { randomUUID } from "node:crypto";

const count = Number(process.argv[2] ?? 7000);
const TEMP_SHARE = 0.57;

const projects = [
  ["homelab", 0.3], ["tapes", 0.15], ["tapes-ui", 0.08], ["murals.plus", 0.12], ["home-ops-containers", 0.06],
  ["dotfiles", 0.05], ["t3code", 0.08], ["lachie-skills", 0.06], ["stackpilot", 0.05], ["fleet", 0.03], ["scratch", 0.02],
];
const harnesses = [["claude", 0.62], ["codex", 0.25], ["opencode", 0.08], ["pi", 0.05]];
const tempTasks = ["Fix failing test", "Implement feature", "Refactor module", "Benchmark task", "Write migration", "Add endpoint"];
const verbs = ["Fix", "Add", "Investigate", "Refactor", "Update", "Review", "Document", "Debug"];
const nouns = ["lan-dns", "ArgoCD sync", "map layout", "session list", "Longhorn backup", "cert-manager", "search cassette", "CI build"];

let seed = 42;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const gaussian = () => Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());
const pick = (weighted) => {
  let r = random() * weighted.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of weighted) if ((r -= w) <= 0) return v;
  return weighted[0][0];
};
const centre = () => [random() * 1.4 - 0.7, random() * 1.4 - 0.7, random() * 1.4 - 0.7];
const centres = new Map([...projects.map(([p]) => p), ...tempTasks].map((k) => [k, centre()]));
const clamp = (v) => Math.max(-1, Math.min(1, v));

const now = Date.now();
const points = Array.from({ length: count }, () => {
  const temp = random() < TEMP_SHARE;
  const project = temp ? "project" : pick(projects);
  const title = temp ? pick(tempTasks.map((t) => [t, 1])) : `${verbs[Math.floor(random() * verbs.length)]} ${nouns[Math.floor(random() * nouns.length)]}`;
  const [cx, cy, cz] = centres.get(temp ? title : project);
  const spread = temp ? 0.08 : 0.15;
  return {
    session_id: randomUUID(),
    x: clamp(cx + gaussian() * spread),
    y: clamp(cy + gaussian() * spread),
    z: clamp(cz + gaussian() * spread),
    span_count: Math.round(Math.exp(random() * 7)),
    harness_id: temp ? "codex" : pick(harnesses),
    cwd: temp ? `/tmp/codex-${randomUUID().slice(0, 8)}/project` : `/Users/lachlan/Projects/${project}`,
    title,
    last_seen_at: new Date(now - random() * 90 * 86400e3).toISOString(),
  };
});

process.stdout.write(JSON.stringify({
  computed_at: new Date(now - 20 * 60e3).toISOString(), model: "embeddinggemma", method: "umap", session_count: count, points,
}));
