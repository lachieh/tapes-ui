import { href } from "../hooks";
import { EmbeddingMap } from "./embedding-map";
import { TimelineView } from "./timeline";

export function MapView({ params }: { params: URLSearchParams }) {
  const embedding = params.get("layout") === "embedding";
  // Links from before the timeline used session= for the structure view.
  const legacySession = params.get("session");
  if (legacySession && !params.get("focus")) {
    location.replace(href("/map", { focus: legacySession }));
    return null;
  }
  const layoutSwitch = (
    <span class="segmented" role="group" aria-label="Layout">
      <a href={href("/map")} aria-current={embedding ? undefined : "true"}>Timeline</a>
      <a href={href("/map", { layout: "embedding" })} aria-current={embedding ? "true" : undefined}>Embedding</a>
    </span>
  );
  return embedding
    ? <EmbeddingMap params={params} layoutSwitch={layoutSwitch} />
    : <TimelineView params={params} layoutSwitch={layoutSwitch} />;
}
