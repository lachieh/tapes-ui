import { useQuery } from "@tanstack/preact-query";
import { ago } from "../format";
import { href } from "../hooks";
import { repoOf } from "../map/embedding";
import { searchQuery } from "../queries";
import { QueryError } from "./status";

export function Search({ query }: { query: string }) {
  const results = useQuery(searchQuery(query));

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
      {results.isFetching && !results.data && <p class="muted">Searching…</p>}
      {results.error && <QueryError error={results.error} retry={() => results.refetch()} />}
      {results.data && results.data.results.length === 0 && <p class="muted">No matches.</p>}
      {results.data && (
        <ol class="results">
          {results.data.results.map((r) => (
            <li key={`${r.trace_id}/${r.span_id}`}>
              <a href={href("/session", { id: r.session_id, turn: r.trace_id })}>
                {r.display_title || r.user_prompt?.slice(0, 120) || r.session_id}
              </a>
              <span class="muted"> {r.score.toFixed(3)} · {r.harness_id} · {r.cwd ? repoOf(r.cwd) : ""} · {ago(r.started_at)}</span>
              {r.snippet && <p class="snippet">{r.snippet}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
