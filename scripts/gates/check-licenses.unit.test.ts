import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runLicenseCheck } from "./check-licenses.js";
import { licenseAllowed, licenseProblems, parsePnpmLicenses, renderNotices } from "./licenses.js";

const canned = JSON.stringify({
  MIT: [
    {
      name: "zod",
      versions: ["4.6.5"],
      license: "MIT",
      author: "Colin McDonnell",
      homepage: "https://zod.dev",
    },
    { name: "@types/node", versions: ["26.6.3", "24.19.0"], license: "MIT" },
  ],
  "(MIT OR GPL-3.0-or-later)": [
    { name: "jszip", versions: ["3.10.2"], license: "(MIT OR GPL-3.0-or-later)" },
  ],
  "(MIT AND Zlib)": [
    { name: "pako", versions: ["1.0.11"], license: "(MIT AND Zlib)", homepage: "https://x.test" },
  ],
});

describe("SPDX allowlist", () => {
  it("accepts allowed identifiers and OR/AND combinations", () => {
    expect(licenseAllowed("MIT")).toBe(true);
    expect(licenseAllowed("mit")).toBe(true);
    expect(licenseAllowed("(GPL-2.0-only OR MIT)")).toBe(true);
    expect(licenseAllowed("(MIT AND Zlib)")).toBe(true);
    expect(licenseAllowed("Apache-2.0 AND (ISC OR BSD-3-Clause)")).toBe(true);
  });

  it("rejects unknown, missing, incompatible and malformed expressions", () => {
    expect(licenseAllowed("GPL-2.0-only")).toBe(false);
    expect(licenseAllowed("(MIT AND GPL-2.0-only)")).toBe(false);
    expect(licenseAllowed("Apache-2.0 WITH LLVM-exception")).toBe(false);
    expect(licenseAllowed("SEE LICENSE IN LICENSE")).toBe(false);
    expect(licenseAllowed("")).toBe(false);
    expect(licenseAllowed("(MIT")).toBe(false);
    expect(licenseAllowed("MIT OR")).toBe(false);
  });
});

describe("license report", () => {
  it("parses the pnpm shape, sorts packages and renders deterministic notices", () => {
    const packages = parsePnpmLicenses(canned);
    expect(packages.map((pkg) => pkg.name)).toEqual(["@types/node", "jszip", "pako", "zod"]);
    expect(packages[0]?.versions).toEqual(["24.19.0", "26.6.3"]);
    expect(licenseProblems(packages)).toEqual([]);
    const notices = renderNotices(packages);
    expect(notices).toBe(renderNotices([...packages].reverse()));
    expect(notices).toContain("@types/node 24.19.0, 26.6.3 — MIT\n");
    expect(notices).toContain("zod 4.6.5 — MIT — Colin McDonnell\n");
    expect(notices).toContain("pako 1.0.11 — (MIT AND Zlib) — https://x.test\n");
    expect(notices).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("lists every package outside the allowlist and does not write notices", () => {
    const root = mkdtempSync(join(tmpdir(), "octo-licenses-"));
    const dirty = JSON.stringify({
      "GPL-2.0-only": [{ name: "old-copyleft", versions: ["1.0.0"], license: "GPL-2.0-only" }],
      Unknown: [{ name: "mystery", versions: ["2.0.0"] }],
      MIT: [{ name: "fine", versions: ["1.0.0"], license: "MIT" }],
    });
    const report = runLicenseCheck({ root, out: "notices.txt", list: () => dirty });
    expect(report.problems).toEqual(["mystery 2.0.0: Unknown", "old-copyleft 1.0.0: GPL-2.0-only"]);
    expect(existsSync(join(root, "notices.txt"))).toBe(false);
  });

  it("writes THIRD-PARTY-NOTICES to --out when every license is allowed", () => {
    const root = mkdtempSync(join(tmpdir(), "octo-licenses-"));
    const report = runLicenseCheck({
      root,
      out: "release/x/THIRD-PARTY-NOTICES.txt",
      list: () => canned,
    });
    expect(report.problems).toEqual([]);
    expect(report.packages).toHaveLength(4);
    const written = readFileSync(join(root, "release/x/THIRD-PARTY-NOTICES.txt"), "utf8");
    expect(written).toBe(renderNotices(report.packages));
  });
});
