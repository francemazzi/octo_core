import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
    expect(store.summary("openrouter")).toEqual({ configured: false, hint: null, model: null });
    expect(store.credential("openrouter")).toBeNull();

    store.save("openrouter", { apiKey: KEY, model: "vendor/model" });
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain(KEY);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(store.summary("openrouter")).toEqual({
      configured: true,
      hint: "abcd",
      model: "vendor/model",
    });
    expect(createSettingsStore(file, fakeBox()).credential("openrouter")).toEqual({
      apiKey: KEY,
      model: "vendor/model",
    });

    store.remove("openrouter");
    expect(store.summary("openrouter").configured).toBe(false);
    expect(readFileSync(file, "utf8")).not.toContain("keyCiphertext");
  });

  it("refuses to save, and does not read, without a safe keystore", () => {
    const file = settingsFile();
    createSettingsStore(file, fakeBox()).save("openrouter", { apiKey: KEY });
    const unsafe = createSettingsStore(file, fakeBox("nessun archivio sicuro"));
    expect(unsafe.problem()).toBe("nessun archivio sicuro");
    expect(() => unsafe.save("openrouter", { apiKey: KEY })).toThrow("nessun archivio sicuro");
    expect(unsafe.credential("openrouter")).toBeNull();
    expect(unsafe.summary("openrouter")).toEqual({ configured: true, hint: "abcd", model: null });
  });
  it("migrates v1 ciphertext and preserves independent keys and the selected provider", () => {
    const file = settingsFile();
    const ciphertext = fakeBox().encrypt(KEY).toString("base64");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        openrouter: { keyCiphertext: ciphertext, hint: "abcd", model: "vendor/model" },
      }),
    );
    const store = createSettingsStore(file, fakeBox());
    expect(store.active()).toBe("openrouter");
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      version: 2,
      providers: { openrouter: { keyCiphertext: ciphertext } },
    });
    store.save("anthropic", { apiKey: "octo-anthropic-test-key" });
    expect(store.active()).toBe("openrouter");
    store.select("anthropic");
    const reopened = createSettingsStore(file, fakeBox());
    expect(reopened.active()).toBe("anthropic");
    expect(reopened.credential("openrouter")?.apiKey).toBe(KEY);
    reopened.remove("openrouter");
    expect(reopened.credential("anthropic")?.apiKey).toBe("octo-anthropic-test-key");
    reopened.remove("anthropic");
    expect(reopened.active()).toBe("anthropic");
    expect(readFileSync(file, "utf8")).not.toContain("keyCiphertext");
  });
});
