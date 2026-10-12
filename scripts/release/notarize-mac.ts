import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STAPLE_ATTEMPTS = 5;
const STAPLE_RETRY_SECONDS = 30;

function capture(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Notarization credentials as notarytool arguments: a keychain profile (OCTO_NOTARY_PROFILE)
 * or Apple ID + team + app-specific password (MACOS_APPLE_* with the older APPLE_* names
 * as fallback). Undefined when nothing is configured.
 */
export function notaryCredentials(): string[] | undefined {
  const profile = process.env.OCTO_NOTARY_PROFILE;
  if (profile) return ["--keychain-profile", profile];
  const appleId = process.env.MACOS_APPLE_ID ?? process.env.APPLE_ID;
  const teamId = process.env.MACOS_APPLE_TEAM_ID ?? process.env.APPLE_TEAM_ID;
  const password = process.env.MACOS_APPLE_APP_PASSWORD ?? process.env.APPLE_APP_PASSWORD;
  if (appleId && teamId && password) {
    return ["--apple-id", appleId, "--team-id", teamId, "--password", password];
  }
  return undefined;
}

/** Fails early when the credentials cannot talk to the notary service. */
export function notaryPreflight(credentials: string[]): void {
  try {
    execFileSync("xcrun", ["notarytool", "history", ...credentials, "--output-format", "json"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`notarytool credentials rejected (notarytool history failed): ${detail}`);
  }
}

type NotaryResult = { id?: string; status?: string; message?: string };

/**
 * Submits a zip or dmg, waits, stores notary-result-<label>.json in `resultDir` and throws
 * unless the status is Accepted (the notary log is saved as notary-log-<label>.json).
 */
export function notarize(
  archive: string,
  credentials: string[],
  resultDir: string,
  label: string,
): void {
  const output = capture("xcrun", [
    "notarytool",
    "submit",
    archive,
    ...credentials,
    "--wait",
    "--output-format",
    "json",
  ]);
  writeFileSync(join(resultDir, `notary-result-${label}.json`), output);
  const result = JSON.parse(output) as NotaryResult;
  if (result.status === "Accepted") return;
  const logPath = join(resultDir, `notary-log-${label}.json`);
  if (result.id) {
    execFileSync("xcrun", ["notarytool", "log", result.id, ...credentials, logPath], {
      stdio: "inherit",
    });
  }
  throw new Error(
    `notarization of ${archive} ended with status ${result.status ?? "unknown"}: ${result.message ?? ""} (see ${logPath})`,
  );
}

/** Staples the ticket with retries (the CDN can lag behind the Accepted status), then validates. */
export function staple(path: string): void {
  for (let attempt = 1; attempt <= STAPLE_ATTEMPTS; attempt += 1) {
    try {
      execFileSync("xcrun", ["stapler", "staple", path], { stdio: "inherit" });
      break;
    } catch (error) {
      if (attempt === STAPLE_ATTEMPTS) throw error;
      process.stderr.write(`stapler attempt ${attempt} failed, retrying in ${STAPLE_RETRY_SECONDS}s\n`);
      execFileSync("sleep", [String(STAPLE_RETRY_SECONDS)]);
    }
  }
  execFileSync("xcrun", ["stapler", "validate", path], { stdio: "inherit" });
}

/** Zips the signed app, notarizes the archive and staples the ticket to the app bundle. */
export function notarizeMacApp(
  appPath: string,
  credentials: string[],
  resultDir: string,
  label: string,
): void {
  const work = mkdtempSync(join(tmpdir(), "octo-notary-"));
  try {
    const archive = join(work, "app.zip");
    execFileSync("ditto", ["-c", "-k", "--keepParent", appPath, archive], { stdio: "inherit" });
    notarize(archive, credentials, resultDir, label);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  staple(appPath);
}
