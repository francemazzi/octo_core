import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EngineRequest } from "./engine-client.js";
import { KEY_RESET_NOTE, loadMediaKey, unlockMediaKey } from "./media-key.js";
import type { SecretBox } from "./settings-store.js";

/** Stands in for the OS keystore: reversible, and never the plain text. */
function fakeBox(problem: string | null = null, mask = 0x5a): SecretBox {
  return {
    problem: () => problem,
    encrypt: (text) => Buffer.from(Buffer.from(text, "utf8").map((byte) => byte ^ mask)),
    decrypt: (data) => Buffer.from(data.map((byte) => byte ^ mask)).toString("utf8"),
  };
}

function keyFile(): string {
  return join(mkdtempSync(join(tmpdir(), "octo-media-key-")), "media-key.bin");
}

describe("media key", () => {
  it("creates one key, keeps only its keystore ciphertext, and gives it back at every start", () => {
    const file = keyFile();
    const first = loadMediaKey(file, fakeBox());
    if (!("key" in first)) throw new Error("no key");
    expect(first.note).toBeNull();
    expect(Buffer.from(first.key, "base64")).toHaveLength(32);
    expect(readFileSync(file).toString("utf8")).not.toContain(first.key);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(loadMediaKey(file, fakeBox())).toEqual({ key: first.key, note: null });
  });

  it("writes nothing without a secure keystore", () => {
    const file = keyFile();
    expect(loadMediaKey(file, fakeBox("nessun archivio sicuro"))).toEqual({
      problem: "nessun archivio sicuro",
    });
    expect(existsSync(file)).toBe(false);
  });

  it("moves an unreadable key aside, never deletes it, and starts a new one with a note", () => {
    const file = keyFile();
    writeFileSync(file, "not a key");
    const reset = loadMediaKey(file, fakeBox(), () => 42);
    if (!("key" in reset)) throw new Error("no key");
    expect(reset.note).toBe(KEY_RESET_NOTE);
    expect(readFileSync(`${file}.unreadable-42`, "utf8")).toBe("not a key");
    expect(loadMediaKey(file, fakeBox())).toEqual({ key: reset.key, note: null });

    const otherComputer = loadMediaKey(file, {
      ...fakeBox(),
      decrypt: () => {
        throw new Error("Error while decrypting the ciphertext provided to safeStorage");
      },
    });
    if (!("key" in otherComputer)) throw new Error("no key");
    expect(otherComputer.key).not.toBe(reset.key);
    expect(
      readdirSync(join(file, "..")).filter((name) => name.includes("unreadable")),
    ).toHaveLength(2);
  });

  it("hands the key to the engine, and nothing without a keystore", async () => {
    const commands: Array<Record<string, unknown>> = [];
    const request: EngineRequest = async (command) => {
      commands.push(command);
      return { ok: true, result: { unlocked: true } };
    };
    const file = keyFile();
    await expect(unlockMediaKey(request, file, fakeBox())).resolves.toBeNull();
    expect(commands).toEqual([{ cmd: "keys.unlock", key: expect.stringMatching(/=$/) }]);
    await expect(unlockMediaKey(request, keyFile(), fakeBox("no"))).resolves.toBeNull();
    expect(commands).toHaveLength(1);
  });
});
