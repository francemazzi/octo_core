import { describe, expect, it } from "vitest";
import { OctoError } from "../errors.js";
import { escapeHtml, resolveInside, safePathSegment } from "./paths.js";

describe("export paths", () => {
  it("rejects traversal and escapes html", () => {
    expect(() => safePathSegment("../etc")).toThrow(OctoError);
    expect(() => resolveInside("/tmp/octo-export", "..", "..", "etc")).toThrow(OctoError);
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });
});
