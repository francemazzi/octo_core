/**
 * Pure download logic for the landing page: which build fits the visitor's computer and how to
 * name it. No DOM access, so vitest can import it; the page calls it from app.js.
 */

export const REPO = "francemazzi/octo_core";
export const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;

/** Build targets as named in the release assets, with the system and chip each one is for. */
export const TARGETS = {
  "mac-arm64": { os: "mac", arch: "arm64", ext: "dmg" },
  "mac-x64": { os: "mac", arch: "x64", ext: "dmg" },
  "win-x64": { os: "win", arch: "x64", ext: "zip" },
  "win-arm64": { os: "win", arch: "arm64", ext: "zip" },
  "linux-x64": { os: "linux", arch: "x64", ext: "zip" },
  "linux-arm64": { os: "linux", arch: "arm64", ext: "zip" },
};

const OS_NAMES = { mac: "macOS", win: "Windows", linux: "Linux" };

const ARCH_NAMES = {
  mac: { arm64: "Apple Silicon", x64: "Intel" },
  win: { arm64: "ARM64", x64: "x64" },
  linux: { arm64: "ARM64", x64: "x64" },
};

const WORDS = {
  it: { download: "Scarica per", unknown: "Scarica" },
  en: { download: "Download for", unknown: "Download" },
};

/** The computer family the browser runs on; phones and tablets get null (no build for them). */
export function detectOs(nav) {
  const hints = nav.userAgentData;
  const platform = String(hints?.platform ?? nav.platform ?? "").toLowerCase();
  const ua = String(nav.userAgent ?? "").toLowerCase();
  const touchMac = /mac/.test(platform) && (nav.maxTouchPoints ?? 0) > 1;
  if (/android|iphone|ipad|ipod/.test(ua) || /android|ios/.test(platform) || touchMac) return null;
  if (/mac/.test(platform) || /mac os/.test(ua)) return "mac";
  if (/win/.test(platform) || /windows/.test(ua)) return "win";
  if (/linux|x11|cros/.test(platform) || /linux|x11/.test(ua)) return "linux";
  return null;
}

/**
 * The chip, as far as the browser tells: Chromium exposes it through client hints, user agents
 * sometimes carry ARM64, and Firefox names the GPU. Safari on a Mac says nothing, so the answer
 * is Apple Silicon with `certain: false` and the page offers the Intel build next to it.
 */
export async function detectArch(nav, os, gpuRenderer = () => "") {
  const hints = nav.userAgentData;
  if (hints && typeof hints.getHighEntropyValues === "function") {
    try {
      const values = await hints.getHighEntropyValues(["architecture", "bitness"]);
      if (values.architecture === "arm") return { arch: "arm64", certain: true };
      if (values.architecture === "x86") return { arch: "x64", certain: true };
    } catch {
      // The hint is optional: fall through to the user agent.
    }
  }
  const ua = String(nav.userAgent ?? "");
  if (/\b(arm64|aarch64)\b/i.test(ua)) return { arch: "arm64", certain: true };
  if (os !== "mac" && /\b(x86_64|x64|win64|wow64|amd64)\b/i.test(ua)) {
    return { arch: "x64", certain: true };
  }
  if (os === "mac") {
    const renderer = String(gpuRenderer() ?? "");
    if (/apple m\d/i.test(renderer)) return { arch: "arm64", certain: true };
    if (/intel|amd|radeon|nvidia/i.test(renderer)) return { arch: "x64", certain: true };
    return { arch: "arm64", certain: false };
  }
  return { arch: "x64", certain: false };
}

/** The renderer string of a WebGL context, when the browser exposes it. */
export function webglRenderer(doc) {
  try {
    const canvas = doc.createElement("canvas");
    const gl = canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  } catch {
    return "";
  }
}

/** The target an asset name belongs to (`OctoCore-1.2.0-mac-arm64.dmg` → `mac-arm64`). */
export function targetOf(assetName) {
  const match = /^OctoCore-[^-]+-((?:mac|win|linux)-(?:arm64|x64))\.(dmg|zip)$/.exec(assetName);
  if (!match) return null;
  const target = match[1];
  return TARGETS[target]?.ext === match[2] ? target : null;
}

/** One asset per target, in the release's asset list, preferring the package format of the system. */
export function assetsByTarget(release) {
  const map = {};
  for (const asset of release?.assets ?? []) {
    const target = targetOf(asset.name);
    if (target) map[target] = asset;
  }
  return map;
}

export function targetFor(os, arch) {
  const target = `${os}-${arch}`;
  return TARGETS[target] ? target : null;
}

/** The build for this computer, or null when there is none for the detected system. */
export function pickAsset(release, os, arch) {
  if (!os) return null;
  const target = targetFor(os, arch);
  if (!target) return null;
  const asset = assetsByTarget(release)[target];
  return asset ? { target, asset } : null;
}

/** The other chip of the same system, for the "Intel Mac?" style link. */
export function alternateTarget(target) {
  const spec = TARGETS[target];
  if (!spec) return null;
  return targetFor(spec.os, spec.arch === "arm64" ? "x64" : "arm64");
}

export function targetLabel(target) {
  const spec = TARGETS[target];
  if (!spec) return "";
  return `${OS_NAMES[spec.os]} (${ARCH_NAMES[spec.os][spec.arch]})`;
}

export function downloadLabel(target, lang = "it") {
  const words = WORDS[lang] ?? WORDS.it;
  return target ? `${words.download} ${targetLabel(target)}` : words.unknown;
}

export function formatSize(bytes, lang = "it") {
  const mb = bytes / 1048576;
  return `${new Intl.NumberFormat(lang === "en" ? "en-US" : "it-IT", { maximumFractionDigits: 0 }).format(mb)} MB`;
}

/** Semantic order of two `1.2.0`-style versions: positive when `a` is newer. */
export function compareVersions(a, b) {
  const parse = (value) =>
    String(value)
      .replace(/^v/, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The GitHub API body of a release reduced to what the page uses; drafts and prereleases are skipped. */
export function fromGithubRelease(body) {
  if (!body || body.draft || body.prerelease || typeof body.tag_name !== "string") return null;
  return {
    version: body.tag_name.replace(/^v/, ""),
    tag: body.tag_name,
    publishedAt: body.published_at ?? "",
    url: body.html_url ?? `https://github.com/${REPO}/releases/tag/${body.tag_name}`,
    assets: (body.assets ?? []).map((asset) => ({
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size ?? 0,
    })),
  };
}
