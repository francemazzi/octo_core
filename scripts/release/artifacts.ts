import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Every regular file under `folder` whose lower-cased extension is listed, sorted. */
export function listFiles(folder: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && extensions.some((ext) => full.toLowerCase().endsWith(ext))) {
        found.push(full);
      }
    }
  };
  walk(folder);
  return found.sort();
}

/**
 * Zips a folder keeping its top-level name. ditto preserves symlinks and bundle structure
 * on macOS; bsdtar on Windows and zip on Linux cover the other hosts.
 */
export function zipFolder(source: string, destination: string): void {
  const parent = dirname(source);
  const name = basename(source);
  if (process.platform === "darwin") {
    execFileSync("ditto", ["-c", "-k", "--keepParent", "--norsrc", source, destination], {
      stdio: "inherit",
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
  } else if (process.platform === "win32") {
    execFileSync("tar", ["-a", "-c", "-f", destination, "-C", parent, name], { stdio: "inherit" });
  } else {
    execFileSync("zip", ["-r", "-y", "-X", "-q", destination, name], { cwd: parent, stdio: "inherit" });
  }
}

/** Read-only compressed disk image of the app; hdiutil exists only on macOS. */
export function createDmg(appPath: string, destination: string): void {
  if (process.platform !== "darwin") throw new Error("DMG images can only be created on macOS");
  execFileSync(
    "hdiutil",
    ["create", "-volname", "Octo Core", "-srcfolder", appPath, "-ov", "-format", "UDZO", destination],
    { stdio: "inherit" },
  );
}

export function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Writes SHA256SUMS.txt in `sha256sum -c` format (hash, two spaces, file name), sorted. */
export function writeChecksums(outDir: string, files: string[]): string {
  const lines = [...files]
    .sort((a, b) => basename(a).localeCompare(basename(b), "en"))
    .map((file) => `${sha256(file)}  ${basename(file)}`);
  const target = join(outDir, "SHA256SUMS.txt");
  writeFileSync(target, `${lines.join("\n")}\n`);
  return target;
}

/** Italian explanation shipped next to packages that are not signed or not notarized. */
export function unsignedNotice(version: string, unsigned: string[]): string {
  return [
    `Octo Core ${version}: pacchetti non firmati per ${unsigned.join(", ")}.`,
    "",
    "Windows: SmartScreen può mostrare «PC protetto da Windows» perché l'eseguibile non ha una firma",
    "Authenticode. Procedere con «Ulteriori informazioni» → «Esegui comunque» solo dopo aver verificato",
    "l'hash del file in SHA256SUMS.txt.",
    "",
    "macOS: Gatekeeper blocca le app non notarizzate. Dopo la verifica dell'hash, aprire l'app con clic",
    'destro → Apri, oppure rimuovere la quarantena con: xattr -dr com.apple.quarantine "Octo Core.app".',
    "",
    "Verifica dell'hash: `shasum -a 256 -c SHA256SUMS.txt` su macOS/Linux, oppure",
    "`certutil -hashfile <file> SHA256` su Windows confrontando il valore con SHA256SUMS.txt.",
    "La firma riguarda solo l'origine del binario: non cambia la licenza GPL-3.0-or-later del codice.",
    "",
  ].join("\n");
}
