import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// `npm run dev` proxies the tapes API paths to TAPES_URL so the browser sees
// one origin, as it does behind the tapes.heywood.dev HTTPRoute.
const target = process.env.TAPES_URL ?? "https://tapes.heywood.dev";
const api = { target, changeOrigin: true, secure: true };

export default defineConfig({
  plugins: [preact()],
  server: {
    proxy: { "/v1": api, "/openapi": api, "/ping": api, "/swagger": api },
  },
});
