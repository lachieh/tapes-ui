# tapes-ui

A browser UI for [tapes](https://github.com/papercomputeco/tapes) agent telemetry. It replaces the single page that `tapes serve --api-web-ui` embeds.

- **Sessions**: aggregate stats, a sortable session list that refreshes every 15s, and per-session turns, spans, and full span payloads.
- **Map**: two layouts, built with [3d-force-graph](https://github.com/vasturiano/3d-force-graph) and loaded only on that page.
  - **Structure**: a force-directed graph of sessions → turns → spans (parent links), with optional emits/feeds data-flow links.
  - **Embedding** (`#/map?layout=embedding`): one point per session, placed by meaning from the map cassette (`/v1/cassettes/map/points`), coloured by harness or project. Filters: `harness=a,b`, `q=` (project or title), `temp=1` to include temp-workspace runs (cwd basename `project`), `colour=project`.
- **Search**: semantic span search through the search cassette (`/v1/cassettes/search/spans`).

The UI only reads the tapes read API (`/v1/...`) from its own origin. Put it on the same hostname as tapes and route the API paths to tapes:

| Path prefix | Backend |
|---|---|
| `/` | tapes-ui (port 8080) |
| `/v1`, `/openapi`, `/ping`, `/swagger`, `/metrics` | tapes read API (port 8081) |

There's no CORS configuration and no runtime config. Live updates use polling. Tapes' cassette proxy doesn't handle WebSocket upgrades.

## Develop

```sh
npm ci
npm run dev                      # proxies the API paths to https://tapes.heywood.dev
TAPES_URL=http://localhost:8081 npm run dev
node scripts/map-fixture.mjs > /tmp/map-points.json
TAPES_MAP_FIXTURE=/tmp/map-points.json npm run dev   # serve map points from a file
TAPES_MAP_FIXTURE=503 npm run dev                    # or answer with a status code
npm test
npm run build
```

## Image

`ghcr.io/lachieh/tapes-ui` serves `dist/` with Caddy on `:8080` as UID 65532, with a health check at `/healthz`. Each push to `main` publishes multi-arch (amd64, arm64) tags `v0.1.<run>` and `rolling`.
