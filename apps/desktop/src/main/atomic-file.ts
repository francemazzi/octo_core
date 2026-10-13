import { renameSync, writeFileSync } from "node:fs";

/** Writes next to the target and renames: a crash never leaves half a file, and only the user reads it. */
export function writeFileAtomic(file: string, data: string | Uint8Array, mode = 0o600): void {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, data, { mode });
  renameSync(temporary, file);
}
