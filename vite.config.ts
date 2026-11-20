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

export default defineConfig({
  plugins: [preact(), mapPointsFixture(process.env.TAPES_MAP_FIXTURE)],
  server: {
    proxy: { "/v1": api, "/openapi": api, "/ping": api, "/swagger": api },
  },
});
