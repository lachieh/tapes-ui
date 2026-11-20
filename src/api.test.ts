import { describe, expect, it } from "vitest";
import { firstOccurrenceById } from "./api";

describe("firstOccurrenceById", () => {
  it("keeps the polled first page's copy when a session also appears on a later page", () => {
    const firstPage = [{ id: "a", v: "fresh" }, { id: "b", v: "fresh" }];
    const laterPages = [{ id: "b", v: "stale" }, { id: "c", v: "stale" }, { id: "c", v: "stale" }];
    expect(firstOccurrenceById([...firstPage, ...laterPages])).toEqual([
      { id: "a", v: "fresh" }, { id: "b", v: "fresh" }, { id: "c", v: "stale" },
    ]);
  });
});
