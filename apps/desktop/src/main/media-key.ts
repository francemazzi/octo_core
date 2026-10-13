import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { writeFileAtomic } from "./atomic-file.js";
import type { EngineRequest } from "./engine-client.js";
import type { SecretBox } from "./settings-store.js";

const KEY_BYTES = 32;

export const KEY_RESET_NOTE =
  "La chiave delle schermate non era più leggibile su questo computer: Octo ne ha creata una nuova. Le sessioni registrate prima non si possono più rileggere; il vecchio file è stato messo da parte.";

export type MediaKey = { key: string; note: string | null } | { problem: string };

/** The stored key, or null when the keystore can no longer open it (new profile, other PC). */
function readKey(file: string, box: SecretBox): string | null {
  let key: string;
  try {
    key = box.decrypt(readFileSync(file));
  } catch {
    return null;
  }
  return Buffer.from(key, "base64").length === KEY_BYTES ? key : null;
}

/**
 * The key that encrypts the screen text, the same at every start so a session stays readable
 * after closing Octo. It lives only as keystore ciphertext; an unreadable file is moved aside,
 * never deleted, and a new key is created.
 */
export function loadMediaKey(file: string, box: SecretBox, now: () => number = Date.now): MediaKey {
  const problem = box.problem();
  if (problem) return { problem };
  let note: string | null = null;
  if (existsSync(file)) {
    const key = readKey(file, box);
    if (key) return { key, note: null };
    renameSync(file, `${file}.unreadable-${now()}`);
    note = KEY_RESET_NOTE;
  }
  const key = randomBytes(KEY_BYTES).toString("base64");
  writeFileAtomic(file, box.encrypt(key));
  return { key, note };
}

/** Hands the key to the engine. Without a keystore the engine stays locked: the list says why. */
export async function unlockMediaKey(
  request: EngineRequest,
  file: string,
  box: SecretBox,
): Promise<string | null> {
  const loaded = loadMediaKey(file, box);
  if ("problem" in loaded) {
    process.stderr.write(`media key not available: ${loaded.problem}\n`);
    return null;
  }
  await request({ cmd: "keys.unlock", key: loaded.key });
  return loaded.note;
}
