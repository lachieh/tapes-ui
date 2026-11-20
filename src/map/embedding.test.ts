import { describe, expect, it } from "vitest";
import {
  countBy, harnessOf, isBackground, isLit, OTHER_COLOUR, palette, parseMapPoints, pointRadius, repoOf, robustBounds, titleOf,
  type MapPoint,
} from "./embedding";

const point = (session_id: string, harness_id: string, cwd: string, title = "", span_count = 10): MapPoint => ({
  session_id, x: 0.5, y: -1, span_count, harness_id, cwd, title, last_seen_at: "2026-11-20T00:00:00Z",
});

describe("parseMapPoints", () => {
  const body = {
    computed_at: "2026-11-20T01:00:00Z", model: "embeddinggemma", method: "umap", session_count: 1,
    points: [{ session_id: "a", x: 0.1, y: 0.2, span_count: 7, harness_id: "claude", cwd: "/p", title: "t", last_seen_at: "2026-11-20T00:00:00Z" }],
  };

  it("accepts the documented 2-D response", () => {
    expect(parseMapPoints(body)).toEqual(body);
  });

  it("ignores the z of an older 3-D response", () => {
    const parsed = parseMapPoints({ points: [{ ...body.points[0], z: 0.4 }] });
    expect(parsed.points[0]).not.toHaveProperty("z");
  });

  it("treats absent text fields as empty", () => {
    const parsed = parseMapPoints({ points: [{ session_id: "a", x: 0, y: 0 }] });
    expect(parsed.points[0]).toMatchObject({ harness_id: "", cwd: "", title: "", span_count: 0 });
    expect(parsed.session_count).toBe(1);
  });

  it("rejects a point without usable coordinates", () => {
    expect(() => parseMapPoints({ points: [{ session_id: "a", x: "0", y: 0 }] })).toThrow("points[0].x");
    expect(() => parseMapPoints({ points: [{ session_id: "a", x: 0, y: null }] })).toThrow("points[0].y");
  });

  it("rejects a body that is not a points response", () => {
    expect(() => parseMapPoints({ error: "computing" })).toThrow("points is not an array");
    expect(() => parseMapPoints(null)).toThrow("not an object");
  });
});

describe("repoOf", () => {
  it.each([
    ["/Users/l/Projects/tambo-ai/charming", "charming"],
    ["/Users/l/Projects/.worktrees/charming/t3-1a2b3c4d", "charming"],
    ["/Volumes/SSD/Projects/.worktrees/homelab/t3-baf7f2e4-77940edd2c138448", "homelab"],
    ["/Volumes/SSD/Home/l/.t3/worktrees/charming/t3code-0f1e2d3c", "charming"],
    ["/Users/l/.herdr/worktrees/charming/widget-improvements", "charming"],
    ["/Users/l/.codex/worktrees/cee3/charming", "charming"],
    ["/Users/l/.codex/worktrees/0a1b2c3d-31f2-4ad0-89a9-0a1b2c3d4e5f/tambo", "tambo"],
    ["/Users/l/Projects/tambo-ai/charming/.worktrees/mediapipe-wasm-csp-contract", "charming"],
    ["/Users/l/.t3/projects/framarchy", "framarchy"],
    ["/Users/l/.t3/scratch/2026-10-16-lachie-mode-work-1234abcd", "(scratch)"],
    ["/private/var/folders/bt/vgbdp5ms/T", "(temp)"],
    ["/tmp/run-1/project", "(temp)"],
    ["/Users/l", "(home)"],
    ["/Volumes/SSD/Home/l/", "(home)"],
    ["", "(no directory)"],
  ])("%s → %s", (cwd, repo) => {
    expect(repoOf(cwd)).toBe(repo);
  });
});

describe("isBackground", () => {
  it("catches near-empty sessions and throwaway directories", () => {
    expect(isBackground(point("a", "claude", "/Users/l/Projects/homelab", "t", 2))).toBe(true);
    expect(isBackground(point("b", "codex", "/tmp/run-1/project", "t", 40))).toBe(true);
    expect(isBackground(point("c", "codex", "/Users/l/Projects/homelab", "t", 3))).toBe(false);
  });
});

describe("titleOf", () => {
  it("drops titles that are only an id fragment", () => {
    expect(titleOf(point("a", "claude", "/p", "01a187ad-d4b"))).toBe("");
    expect(titleOf(point("a", "claude", "/p", "8c2855f5c0e1"))).toBe("");
    expect(titleOf(point("a", "claude", "/p", "Fix lan-dns"))).toBe("Fix lan-dns");
  });
});

describe("palette", () => {
  const repos = (n: number) => Array.from({ length: n }, (_, i) => point(`r${i}`, "claude", `/Users/l/Projects/repo-${i % 10}`));

  it("keeps the fixed harness colours", () => {
    const p = palette([point("a", "claude", "/p"), point("b", "codex", "/p")], "harness");
    expect(p.colourOf("claude")).toBe("#f28e2b");
    expect(p.other).toEqual([]);
  });

  it("gives the largest repos distinct colours and the rest grey", () => {
    const p = palette([...repos(100), point("t", "codex", "/tmp/x")], "repo");
    const colours = p.named.map(([key]) => p.colourOf(key));
    expect(new Set(colours).size).toBe(colours.length);
    expect(colours).not.toContain(OTHER_COLOUR);
    expect(p.other.map(([key]) => p.colourOf(key))).toEqual(p.other.map(() => OTHER_COLOUR));
    expect(p.other.map(([key]) => key)).toContain("(temp)");
  });
});

describe("isLit", () => {
  const a = point("a", "claude", "/Users/l/Projects/homelab", "Fix lan-dns");
  const b = point("b", "codex", "/Users/l/.codex/worktrees/cee3/tapes-ui", "Map layout");

  it("lights everything with no highlight", () => {
    expect([a, b].map((p) => isLit(p, "harness", { text: "" }))).toEqual([true, true]);
  });

  it("keeps only the chosen keys of the colour dimension", () => {
    expect([a, b].map((p) => isLit(p, "repo", { only: new Set(["tapes-ui"]), text: "" }))).toEqual([false, true]);
    expect([a, b].map((p) => isLit(p, "harness", { only: new Set(["claude"]), text: "" }))).toEqual([true, false]);
  });

  it("matches text against title and directory, case-insensitively", () => {
    expect([a, b].map((p) => isLit(p, "harness", { text: " LAN-dns " }))).toEqual([true, false]);
    expect([a, b].map((p) => isLit(p, "harness", { text: "tapes-ui" }))).toEqual([false, true]);
  });
});

describe("robustBounds", () => {
  it("ignores a few far outliers", () => {
    const pts = Array.from({ length: 200 }, (_, i) => ({ x: (i % 20) / 100, y: Math.floor(i / 20) / 100 }));
    pts.push({ x: -1, y: -1 }, { x: 1, y: 1 });
    const b = robustBounds(pts)!;
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(0.2);
    expect(b.maxY).toBeLessThanOrEqual(0.1);
  });

  it("keeps every point when there are few", () => {
    expect(robustBounds([{ x: -1, y: 0 }, { x: 1, y: 2 }])).toEqual({ minX: -1, maxX: 1, minY: 0, maxY: 2 });
    expect(robustBounds([])).toBeUndefined();
  });
});

describe("pointRadius", () => {
  it("grows with session size but stays small", () => {
    expect(pointRadius(100)).toBeGreaterThan(pointRadius(2));
    expect(pointRadius(100_000)).toBeLessThanOrEqual(5.6);
  });
});

describe("countBy", () => {
  it("counts keys largest first", () => {
    const pts = [point("a", "claude", "/p"), point("b", "codex", "/p"), point("c", "codex", "/p"), point("d", "", "/p")];
    expect(countBy(pts, harnessOf)).toEqual([["codex", 2], ["claude", 1], ["unknown", 1]]);
  });
});
