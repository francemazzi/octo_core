import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";

const entitlements = join(import.meta.dirname, "entitlements.plist");

function capture(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/**
 * The Developer ID Application identity: MACOS_DEVELOPER_ID (CI), OCTO_MAC_SIGN_IDENTITY
 * (older local name) or the first one in the keychain. A named identity that is not in the
 * keychain is an error, not a silent unsigned build.
 */
export function macIdentity(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  const named = process.env.MACOS_DEVELOPER_ID ?? process.env.OCTO_MAC_SIGN_IDENTITY;
  const listing = capture("security", ["find-identity", "-v", "-p", "codesigning"]);
  if (named) {
    if (!listing.includes(named)) {
      throw new Error(
        `signing identity "${named}" is not in the keychain (security find-identity -v -p codesigning)`,
      );
    }
    return named;
  }
  return /"(Developer ID Application:[^"]+)"/.exec(listing)?.[1];
}

function isMachO(path: string): boolean {
  return capture("file", ["-b", path]).includes("Mach-O");
}

function depth(path: string): number {
  return path.split("/").length;
}

function codesign(identity: string, path: string, hardened: boolean): void {
  const options = hardened ? ["--options", "runtime", "--entitlements", entitlements] : [];
  execFileSync(
    "codesign",
    ["--force", "--timestamp", ...options, "--sign", identity, path],
    { stdio: "inherit" },
  );
}

function verifySignature(path: string, deep: boolean): void {
  execFileSync(
    "codesign",
    ["--verify", ...(deep ? ["--deep"] : []), "--strict", "--verbose=2", path],
    { stdio: "inherit" },
  );
}

/**
 * Signs inside-out (Mach-O binaries, then frameworks and helper apps, then the app) with the
 * hardened runtime and the Electron entitlements, then verifies strictly. Never `--deep`
 * for signing: nested code gets its own explicit signature.
 */
export function signMacApp(appPath: string, identity: string): void {
  const files = capture("find", [appPath, "-type", "f"]).split("\n").filter(Boolean);
  const bundles = capture("find", [
    appPath,
    "-type",
    "d",
    "(",
    "-name",
    "*.framework",
    "-o",
    "-name",
    "*.app",
    ")",
  ])
    .split("\n")
    .filter((path) => path && path !== appPath);
  for (const file of files.filter(isMachO).sort((a, b) => depth(b) - depth(a))) {
    codesign(identity, file, true);
  }
  for (const bundle of bundles.sort((a, b) => depth(b) - depth(a))) codesign(identity, bundle, true);
  codesign(identity, appPath, true);
  verifySignature(appPath, true);
}

/** Signs the disk image with a timestamp only (no hardened runtime: it is not code). */
export function signDmg(dmgPath: string, identity: string): void {
  codesign(identity, dmgPath, false);
  verifySignature(dmgPath, false);
}

export type GatekeeperVerdict = { accepted: boolean; lines: string[] };

function spctl(args: string[]): { accepted: boolean; output: string } {
  const result = spawnSync("spctl", args, { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().replace(/\s+/g, " ");
  return { accepted: result.status === 0, output };
}

/**
 * Runs Apple's two Gatekeeper assessments (app as executable, dmg as an installable
 * source). The caller decides whether a rejection is fatal: it is expected when the
 * build is signed but not notarized.
 */
export function assessWithGatekeeper(appPath: string, dmgPath: string): GatekeeperVerdict {
  const app = spctl(["-a", "-vvv", "-t", "exec", appPath]);
  const dmg = spctl(["-a", "-t", "open", "--context", "context:primary-signature", "-v", dmgPath]);
  return {
    accepted: app.accepted && dmg.accepted,
    lines: [`spctl app: ${app.output}`, `spctl dmg: ${dmg.output}`],
  };
}
