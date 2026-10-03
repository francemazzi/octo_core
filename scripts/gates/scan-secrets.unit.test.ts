import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findSecrets } from "./scan-secrets.js";

describe("secret scan", () => {
  it("flags a committed-looking token and ignores the synthetic marker", () => {
    const root = mkdtempSync(join(tmpdir(), "octo-secret-"));
    const token = `${"ghp_"}${"abcdefghijklmnopqrst"}`;
    writeFileSync(join(root, "leak.ts"), `const key = '${token}';\n`);
    writeFileSync(join(root, "ok.ts"), "const marker = 'SYNTHETIC_SECRET_MARKER';\n");
    const openRouterKey = `${"sk-or-v1-"}${"0123456789abcdef"}`;
    writeFileSync(join(root, ".env"), `OPENROUTER_API_KEY=${openRouterKey}\n`);
    writeFileSync(join(root, "notes.md"), `chiave ${openRouterKey}\n`);
    const hits = findSecrets(root);
    expect(hits.map((hit) => hit.file)).toContain("leak.ts");
    expect(hits.map((hit) => hit.file)).toContain("notes.md");
    expect(hits.map((hit) => hit.file)).not.toContain("ok.ts");
    expect(hits.map((hit) => hit.file)).not.toContain(".env");
  });
});
