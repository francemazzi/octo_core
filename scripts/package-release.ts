import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import packager from "@electron/packager";
import { runLicenseCheck } from "./gates/check-licenses.js";
import { createDmg, unsignedNotice, writeChecksums, zipFolder } from "./release/artifacts.js";
import { writeIcons } from "./release/icons.js";
import {
  notarize,
  notarizeMacApp,
  notaryCredentials,
  notaryPreflight,
  staple,
} from "./release/notarize-mac.js";
import { assessWithGatekeeper, macIdentity, signDmg, signMacApp } from "./release/sign-mac.js";
import { signWindowsFolder, windowsSigningConfigured } from "./release/sign-win.js";

const root = process.cwd();
const desktopDir = join(root, "apps/desktop");
const desktopPackage = JSON.parse(readFileSync(join(desktopDir, "package.json"), "utf8")) as {
  version: string;
};
const version = desktopPackage.version;
const outDir = join(root, "release", version);

const targets = [
  { platform: "darwin", arch: "arm64", label: "mac-arm64" },
  { platform: "darwin", arch: "x64", label: "mac-x64" },
  { platform: "win32", arch: "x64", label: "win-x64" },
  { platform: "win32", arch: "arm64", label: "win-arm64" },
  { platform: "linux", arch: "x64", label: "linux-x64" },
  { platform: "linux", arch: "arm64", label: "linux-arm64" },
] as const;
type Target = (typeof targets)[number];

const args = process.argv.slice(2);
const skipBuild = args.includes("--no-build");
const requested = new Set(args.filter((arg) => !arg.startsWith("--")));
const selected = targets.filter((target) => requested.size === 0 || requested.has(target.label));
if (selected.length === 0) throw new Error(`unknown target: ${[...requested].join(", ")}`);
const needsMac = selected.some((target) => target.platform === "darwin");
if (needsMac && process.platform !== "darwin") {
  throw new Error("macOS targets must be packaged on macOS (codesign, notarytool, hdiutil)");
}

function run(command: string, commandArgs: string[]): void {
  execFileSync(command, commandArgs, { cwd: root, stdio: "inherit" });
}

if (!skipBuild) {
  run("pnpm", ["--filter", "@octo/desktop", "build"]);
  run("pnpm", ["--filter", "@octo/desktop", "bundle-engine"]);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Rights before binaries: the notices ship inside every package and next to it.
const noticesRelative = `release/${version}/THIRD-PARTY-NOTICES.txt`;
const licenses = runLicenseCheck({ root, out: noticesRelative });
if (licenses.problems.length > 0) {
  throw new Error(`licenses outside the allowlist:\n${licenses.problems.join("\n")}`);
}
const licensePath = join(outDir, "LICENSE");
copyFileSync(join(root, "LICENSE"), licensePath);
const noticesPath = join(root, noticesRelative);

const icon = writeIcons(root);
if (!icon) process.stderr.write("icons are built on macOS only; packages keep Electron's icon\n");

const identity = needsMac ? macIdentity() : undefined;
const notary = identity ? notaryCredentials() : undefined;
if (notary) notaryPreflight(notary);
const windowsSigning = selected.some((t) => t.platform === "win32") && windowsSigningConfigured();

const artifacts: string[] = [];
const signed: string[] = [];
const unsigned: string[] = [];
const notes: string[] = [];

async function packageTarget(target: Target): Promise<string> {
  const packaged = await packager({
    dir: desktopDir,
    name: "Octo Core",
    executableName: "OctoCore",
    platform: target.platform,
    arch: target.arch,
    out: join(outDir, "apps"),
    overwrite: true,
    quiet: true,
    asar: true,
    appVersion: version,
    icon,
    ...(target.platform === "darwin"
      ? {
          extendInfo: {
            CFBundleDisplayName: "Octo",
            CFBundleName: "Octo",
            CFBundleIconFile: "octo.icns",
          },
        }
      : {}),
    extraResource: [join(desktopDir, "dist/engine.mjs"), licensePath, noticesPath],
    ignore: (filePath) => {
      const relative = filePath.replaceAll("\\", "/");
      if (relative === "" || relative === "/package.json" || relative === "/dist") return false;
      if (relative.startsWith("/dist/")) return relative === "/dist/engine.mjs";
      return true;
    },
    prune: false,
  });
  const folder = packaged[0];
  if (!folder) throw new Error(`empty package for ${target.label}`);
  return folder;
}

function finishWindows(folder: string, label: string): void {
  if (!windowsSigning) {
    unsigned.push(label);
    return;
  }
  const report = signWindowsFolder(folder, join(outDir, `windows-signing-report-${label}.json`));
  notes.push(`${label}: ${report.files.length} binaries signed with ${report.tool}`);
  signed.push(label);
}

/** Display name, icon cleanup, then signature and notarization of the app bundle itself. */
function prepareMacApp(folder: string, label: string): string {
  const appPath = join(folder, "Octo Core.app");
  execFileSync("plutil", [
    "-replace",
    "CFBundleDisplayName",
    "-string",
    "Octo",
    join(appPath, "Contents", "Info.plist"),
  ]);
  rmSync(join(appPath, "Contents", "Resources", "electron.icns"), { force: true });
  if (identity) {
    signMacApp(appPath, identity);
    if (notary) notarizeMacApp(appPath, notary, outDir, `${label}-app`);
  }
  return appPath;
}

/** DMG from the stapled app, signed and notarized on its own, then assessed by Gatekeeper. */
function finishMac(appPath: string, label: string): void {
  const dmgPath = join(outDir, `OctoCore-${version}-${label}.dmg`);
  createDmg(appPath, dmgPath);
  artifacts.push(dmgPath);
  if (!identity) {
    unsigned.push(label);
    return;
  }
  signDmg(dmgPath, identity);
  if (notary) {
    notarize(dmgPath, notary, outDir, `${label}-dmg`);
    staple(dmgPath);
  }
  const verdict = assessWithGatekeeper(appPath, dmgPath);
  notes.push(...verdict.lines.map((line) => `${label} ${line}`));
  if (!notary) {
    unsigned.push(`${label} (firmato, non notarizzato)`);
    return;
  }
  if (!verdict.accepted) throw new Error(`Gatekeeper rejected ${label} after notarization`);
  signed.push(label);
}

for (const target of selected) {
  const folder = await packageTarget(target);
  if (target.platform === "win32") finishWindows(folder, target.label);
  const appPath = target.platform === "darwin" ? prepareMacApp(folder, target.label) : undefined;
  const zipPath = join(outDir, `OctoCore-${version}-${target.label}.zip`);
  zipFolder(folder, zipPath);
  artifacts.push(zipPath);
  if (appPath) finishMac(appPath, target.label);
  if (target.platform === "linux")
    notes.push(`${target.label}: no signature by design, verify SHA256SUMS.txt`);
}

const checksums = writeChecksums(outDir, artifacts);
if (unsigned.length > 0)
  writeFileSync(join(outDir, "UNSIGNED.txt"), unsignedNotice(version, unsigned));
process.stdout.write(
  `${[...artifacts, checksums, licensePath, noticesPath].join("\n")}\n${notes.join("\n")}${notes.length ? "\n" : ""}signed: ${signed.join(", ") || "none"}\nunsigned: ${unsigned.join(", ") || "none"}\n`,
);
