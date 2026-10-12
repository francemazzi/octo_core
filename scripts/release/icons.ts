import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const iconDir = join(tmpdir(), "octo-icons");

function resize(source: string, size: number, destination: string): void {
  execFileSync("sips", ["-z", String(size), String(size), source, "--out", destination], {
    stdio: "ignore",
  });
}

/** Wraps a PNG in a single-entry ICO container (Windows accepts PNG-compressed entries). */
function writeIco(png: string, destination: string): void {
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
  writeFileSync(destination, Buffer.concat([header, entry, pngBytes]));
}

/**
 * Builds icon.icns and icon.ico from logo_octo.png and returns the extension-less prefix
 * expected by @electron/packager. Needs sips and iconutil, so it only runs on macOS;
 * on other hosts the packages keep Electron's default icon (documented limitation).
 */
export function writeIcons(root: string): string | undefined {
  if (process.platform !== "darwin") return undefined;
  rmSync(iconDir, { recursive: true, force: true });
  mkdirSync(iconDir, { recursive: true });
  const png = join(iconDir, "icon.png");
  resize(join(root, "logo_octo.png"), 512, png);
  const iconset = join(iconDir, "icon.iconset");
  mkdirSync(iconset);
  for (const size of [16, 32, 64, 128, 256, 512]) {
    resize(png, size, join(iconset, `icon_${size}x${size}.png`));
    const retina = size * 2;
    if (retina <= 512) resize(png, retina, join(iconset, `icon_${size}x${size}@2x.png`));
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(iconDir, "icon.icns")], {
    stdio: "ignore",
  });
  writeIco(png, join(iconDir, "icon.ico"));
  return join(iconDir, "icon");
}
