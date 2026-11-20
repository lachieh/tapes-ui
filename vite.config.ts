import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";

const target = process.env.TAPES_URL ?? "https://tapes.heywood.dev";
const api = { target, changeOrigin: true, secure: true };

function mapPointsFixture(fixture: string | undefined): Plugin[] {
  if (!fixture) return [];
  return [{
    name: "map-points-fixture",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/v1/cassettes/map/points", (_req, res) => {
        const status = /^\d{3}$/.test(fixture) ? Number(fixture) : 200;
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(status === 200 ? readFileSync(fixture) : JSON.stringify({ error: `fixture status ${status}` }));
      });
    },
  }];
}

// TAPES_TIMELINE_FIXTURE is a directory holding timeline.json and turn-<trace_id>.json.
function timelineFixture(dir: string | undefined): Plugin[] {
  if (!dir) return [];
  return [{
    name: "timeline-fixture",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/v1/cassettes/map/timeline", (req, res) => {
        const path = (req.url ?? "/").split("?")[0]!;
        const turn = path.match(/^\/turns\/([^/]+)$/);
        const file = turn ? `${dir}/turn-${decodeURIComponent(turn[1]!)}.json` : `${dir}/timeline.json`;
        res.setHeader("content-type", "application/json");
        try {
          res.end(readFileSync(file));
        } catch {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "no fixture for this turn" }));
        }
      });
    },
  }];
}

export default defineConfig({
  plugins: [preact(), mapPointsFixture(process.env.TAPES_MAP_FIXTURE), timelineFixture(process.env.TAPES_TIMELINE_FIXTURE)],
  server: {
    proxy: { "/v1": api, "/openapi": api, "/ping": api, "/swagger": api },
  },
});
