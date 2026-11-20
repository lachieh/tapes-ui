import { describe, expect, it } from "vitest";
import { countBy, filterPoints, harnessOf, nodeVal, parseMapPoints, projectOf, SCENE_RADIUS, toNodes, type MapPoint } from "./embedding";

const point = (session_id: string, harness_id: string, cwd: string, title = ""): MapPoint => ({
  session_id, x: 0.5, y: -1, z: 0, span_count: 3, harness_id, cwd, title, last_seen_at: "2026-11-20T00:00:00Z",
});

const points = [
  point("a", "claude", "/Users/l/Projects/homelab", "Fix lan-dns"),
  point("b", "codex", "/tmp/run-1/project", "Benchmark task"),
  point("c", "codex", "/Users/l/Projects/tapes-ui", "Map layout"),
  point("d", "", "", "Orphan"),
];

const ids = (ps: MapPoint[]) => ps.map((p) => p.session_id);

describe("parseMapPoints", () => {
  const body = {
    computed_at: "2026-11-20T01:00:00Z", model: "embeddinggemma", method: "umap", session_count: 1,
    points: [{ session_id: "a", x: 0.1, y: 0.2, z: -0.3, span_count: 7, harness_id: "claude", cwd: "/p", title: "t", last_seen_at: "2026-11-20T00:00:00Z" }],
  };

  it("accepts the documented response", () => {
    expect(parseMapPoints(body)).toEqual(body);
  });

  it("treats absent text fields as empty", () => {
    const parsed = parseMapPoints({ points: [{ session_id: "a", x: 0, y: 0, z: 0 }] });
    expect(parsed.points[0]).toMatchObject({ harness_id: "", cwd: "", title: "", span_count: 0 });
    expect(parsed.session_count).toBe(1);
  });

  it("rejects a point without usable coordinates", () => {
    expect(() => parseMapPoints({ points: [{ session_id: "a", x: "0", y: 0, z: 0 }] })).toThrow("points[0].x");
    expect(() => parseMapPoints({ points: [{ session_id: "a", x: 0, y: null, z: 0 }] })).toThrow("points[0].y");
  });

  it("rejects a body that is not a points response", () => {
    expect(() => parseMapPoints({ error: "computing" })).toThrow("points is not an array");
    expect(() => parseMapPoints(null)).toThrow("not an object");
  });
});

describe("filterPoints", () => {
  const all = { text: "", includeTempWorkspaces: true };

  it("hides temp workspace runs unless included", () => {
    expect(ids(filterPoints(points, { ...all, includeTempWorkspaces: false }))).toEqual(["a", "c", "d"]);
    expect(ids(filterPoints(points, all))).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps only the shown harnesses, with no harness counted as unknown", () => {
    expect(ids(filterPoints(points, { ...all, harnesses: new Set(["codex"]) }))).toEqual(["b", "c"]);
    expect(ids(filterPoints(points, { ...all, harnesses: new Set(["unknown"]) }))).toEqual(["d"]);
    expect(ids(filterPoints(points, { ...all, harnesses: new Set() }))).toEqual([]);
  });

  it("matches text against project and title, case-insensitively", () => {
    expect(ids(filterPoints(points, { ...all, text: "TAPES" }))).toEqual(["c"]);
    expect(ids(filterPoints(points, { ...all, text: " lan-dns " }))).toEqual(["a"]);
  });
});

describe("colour keys", () => {
  it("derives the project from the cwd basename", () => {
    expect(points.map(projectOf)).toEqual(["homelab", "project", "tapes-ui", "(no project)"]);
    expect(points.map(harnessOf)).toEqual(["claude", "codex", "codex", "unknown"]);
  });

  it("colours nodes by the chosen key", () => {
    expect(toNodes(points, "harness").map((n) => n.colourKey)).toEqual(["claude", "codex", "codex", "unknown"]);
    expect(toNodes(points, "project").map((n) => n.colourKey)).toEqual(["homelab", "project", "tapes-ui", "(no project)"]);
  });

  it("counts keys largest first", () => {
    expect(countBy(points, harnessOf)).toEqual([["codex", 2], ["claude", 1], ["unknown", 1]]);
  });
});

describe("toNodes", () => {
  it("scales unit coordinates to the scene radius", () => {
    const [node] = toNodes([point("a", "claude", "/p")], "harness");
    expect(node).toMatchObject({ id: "a", x: 0.5 * SCENE_RADIUS, y: -SCENE_RADIUS, z: 0 });
  });
});

describe("nodeVal", () => {
  it("grows with span count but far slower than linearly", () => {
    expect(nodeVal(0)).toBe(1);
    expect(nodeVal(10)).toBeGreaterThan(nodeVal(1));
    expect(nodeVal(1000)).toBeGreaterThan(nodeVal(100));
    expect(nodeVal(1000) / nodeVal(1)).toBeLessThan(10);
  });
});
