import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSettingsStore, type SecretBox } from "./settings-store.js";

const KEY = "octo-test-key-abcd";

/** Stands in for the OS keystore: reversible, and never the plain text. */
function fakeBox(problem: string | null = null): SecretBox {
  return {
    problem: () => problem,
    encrypt: (text) => Buffer.from(Buffer.from(text, "utf8").map((byte) => byte ^ 0x5a)),
    decrypt: (data) => Buffer.from(data.map((byte) => byte ^ 0x5a)).toString("utf8"),
  };
}

function settingsFile(): string {
  return join(mkdtempSync(join(tmpdir(), "octo-settings-")), "settings.json");
}

describe("app settings", () => {
  it("stores the key only as keystore ciphertext, readable by this user only", () => {
    const file = settingsFile();
    const store = createSettingsStore(file, fakeBox());
    expect(store.summary()).toEqual({ configured: false, hint: null, model: null });
    expect(store.readOpenRouter()).toBeNull();

    store.writeOpenRouter({ apiKey: KEY, model: "vendor/model" });
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain(KEY);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(store.summary()).toEqual({ configured: true, hint: "abcd", model: "vendor/model" });
    expect(createSettingsStore(file, fakeBox()).readOpenRouter()).toEqual({
      apiKey: KEY,
      model: "vendor/model",
    });

    store.clearOpenRouter();
    expect(store.summary().configured).toBe(false);
    expect(readFileSync(file, "utf8")).not.toContain("keyCiphertext");
  });

  it("refuses to save, and does not read, without a safe keystore", () => {
    const file = settingsFile();
    createSettingsStore(file, fakeBox()).writeOpenRouter({ apiKey: KEY });
    const unsafe = createSettingsStore(file, fakeBox("nessun archivio sicuro"));
    expect(unsafe.problem()).toBe("nessun archivio sicuro");
    expect(() => unsafe.writeOpenRouter({ apiKey: KEY })).toThrow("nessun archivio sicuro");
    expect(unsafe.readOpenRouter()).toBeNull();
    expect(unsafe.summary()).toEqual({ configured: true, hint: "abcd", model: null });
  });
});
