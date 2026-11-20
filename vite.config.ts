import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

const target = process.env.TAPES_URL ?? "https://tapes.heywood.dev";
const api = { target, changeOrigin: true, secure: true };

export default defineConfig({
  plugins: [preact()],
  server: {
    proxy: { "/v1": api, "/openapi": api, "/ping": api, "/swagger": api },
  },
});
