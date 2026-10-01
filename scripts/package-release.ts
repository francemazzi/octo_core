import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packager from "@electron/packager";

const version = "1.0.0";
const root = process.cwd();
const desktopDir = join(root, "apps/desktop");
const outDir = join(root, "release", version);
const iconDir = join(tmpdir(), "octo-icons");

const targets = [
  { platform: "darwin", arch: "arm64", label: "mac-arm64" },
  { platform: "darwin", arch: "x64", label: "mac-x64" },
  { platform: "win32", arch: "x64", label: "win-x64" },
  { platform: "win32", arch: "arm64", label: "win-arm64" },
  { platform: "linux", arch: "x64", label: "linux-x64" },
  { platform: "linux", arch: "arm64", label: "linux-arm64" },
] as const;

const requested = new Set(process.argv.slice(2));
const selected = targets.filter((target) => requested.size === 0 || requested.has(target.label));
if (selected.length === 0) {
  throw new Error(`unknown target: ${process.argv.slice(2).join(", ")}`);
}

function run(command: string, args: string[]): void {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

function writeIcons(): string {
  rmSync(iconDir, { recursive: true, force: true });
  mkdirSync(iconDir, { recursive: true });
  const png = join(iconDir, "icon.png");
  execFileSync("sips", ["-z", "512", "512", join(root, "logo_octo.png"), "--out", png], {
    stdio: "ignore",
  });
  const iconset = join(iconDir, "icon.iconset");
  mkdirSync(iconset);
  for (const size of [16, 32, 64, 128, 256, 512]) {
    execFileSync(
      "sips",
      ["-z", String(size), String(size), png, "--out", join(iconset, `icon_${size}x${size}.png`)],
      { stdio: "inherit" },
    );
    const retina = size * 2;
    if (retina <= 512) {
      execFileSync(
        "sips",
        [
          "-z",
          String(retina),
          String(retina),
          png,
          "--out",
          join(iconset, `icon_${size}x${size}@2x.png`),
        ],
        { stdio: "inherit" },
      );
    }
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(iconDir, "icon.icns")], {
    stdio: "ignore",
  });
  const pngBytes = readFileSync(png);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);
  entry.writeUInt8(0, 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBytes.length, 8);
  entry.writeUInt32LE(22, 12);
  writeFileSync(join(iconDir, "icon.ico"), Buffer.concat([header, entry, pngBytes]));
  return join(iconDir, "icon");
}

function zip(source: string, destination: string): void {
  execFileSync("ditto", ["-c", "-k", "--keepParent", "--norsrc", source, destination], {
    stdio: "inherit",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
}

function dmg(appPath: string, destination: string): void {
  execFileSync(
    "hdiutil",
    [
      "create",
      "-volname",
      "Octo Core",
      "-srcfolder",
      appPath,
      "-ov",
      "-format",
      "UDZO",
      destination,
    ],
    { stdio: "inherit" },
  );
}

run("pnpm", ["--filter", "@octo/desktop", "build"]);
run("pnpm", ["--filter", "@octo/desktop", "bundle-engine"]);

const icon = writeIcons();
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const artifacts: string[] = [];

for (const target of selected) {
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
    extraResource: [join(desktopDir, "dist/engine.mjs")],
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
  const zipPath = join(outDir, `OctoCore-${version}-${target.label}.zip`);
  zip(folder, zipPath);
  artifacts.push(zipPath);
  if (target.platform === "darwin") {
    const dmgPath = join(outDir, `OctoCore-${version}-${target.label}.dmg`);
    dmg(join(folder, "Octo Core.app"), dmgPath);
    artifacts.push(dmgPath);
  }
}

writeFileSync(
  join(outDir, "UNSIGNED.txt"),
  "Octo Core 1.0.0 is not code-signed. macOS and Windows will show a security warning.\n",
);
process.stdout.write(`${artifacts.join("\n")}\n`);
