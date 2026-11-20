import { QueryClientProvider } from "@tanstack/preact-query";
import { render } from "preact";
import { lazy, Suspense } from "preact/compat";
import { href, useRoute } from "./hooks";
import { queryClient } from "./queries";
import { Search } from "./views/search";
import { SessionDetail, Sessions } from "./views/sessions";
import "./styles.css";

const MapView = lazy(() => import("./views/map").then((m) => m.MapView));

function App() {
  const { path, params } = useRoute();
  const nav = (to: string, label: string) => (
    <a href={href(to)} aria-current={path === to || (to === "/" && path === "/session") ? "page" : undefined}>{label}</a>
  );

  return (
    <>
      <header class="top">
        <h1>Tapes</h1>
        <nav>
          {nav("/", "Sessions")}
          {nav("/map", "Map")}
          {nav("/search", "Search")}
          <a href="/swagger">API</a>
        </nav>
      </header>
      <main>
        {path === "/session" && params.get("id") ? (
          <SessionDetail id={params.get("id")!} turn={params.get("turn") ?? undefined} />
        ) : path === "/map" ? (
          <Suspense fallback={<p class="page muted">Loading map…</p>}>
            <MapView params={params} />
          </Suspense>
        ) : path === "/search" ? (
          <Search query={params.get("q") ?? ""} />
        ) : (
          <Sessions sort={params.get("sort") ?? "last_active"} />
        )}
      </main>
    </>
  );
}

render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
  document.getElementById("app")!,
);
