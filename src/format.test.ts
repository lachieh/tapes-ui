import { describe, expect, it } from "vitest";
import { escapeHtml } from "./format";

describe("escapeHtml", () => {
  it("renders a title containing markup as text", () => {
    expect(escapeHtml(`Fix <img src=x onerror="alert('x')"> & more`)).toBe(
      "Fix &lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; more",
    );
  });
});
