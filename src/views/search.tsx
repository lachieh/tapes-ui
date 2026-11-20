import { api } from "../api";
import { ago, basename } from "../format";
import { href, useLoad } from "../hooks";

// Semantic search through the search cassette (/v1/cassettes/search/spans).
export function Search({ query }: { query: string }) {
  const results = useLoad(
    (s) => (query ? api.search(query, 25, s) : Promise.resolve({ results: [] })),
    [query],
  );

  return (
    <div class="page">
      <form
        class="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          const q = new FormData(e.currentTarget).get("q");
          location.hash = href("/search", { q: String(q ?? "") });
        }}
      >
        <input name="q" type="search" placeholder="Search spans by meaning…" value={query} autoFocus />
        <button type="submit">Search</button>
      </form>
      {results.state === "loading" && query && <p class="muted">Searching…</p>}
      {results.state === "error" && <p class="error">{results.error}</p>}
      {results.state === "ready" && query && results.data.results.length === 0 && <p class="muted">No matches.</p>}
      {results.state === "ready" && (
        <ol class="results">
          {results.data.results.map((r) => (
            <li key={`${r.trace_id}/${r.span_id}`}>
              <a href={href("/session", { id: r.session_id, turn: r.trace_id })}>
                {r.display_title || r.user_prompt?.slice(0, 120) || r.session_id}
              </a>
              <span class="muted"> {r.score.toFixed(3)} · {r.harness_id} · {basename(r.cwd)} · {ago(r.started_at)}</span>
              {r.snippet && <p class="snippet">{r.snippet}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
