import { describe, expect, it } from "vitest";
import {
  alternateTarget,
  assetsByTarget,
  compareVersions,
  detectArch,
  detectOs,
  downloadLabel,
  fromGithubRelease,
  pickAsset,
  targetOf,
  type SiteRelease,
} from "../../site/download.js";

const release: SiteRelease = {
  version: "1.2.0",
  tag: "v1.2.0",
  publishedAt: "2026-10-12T22:40:00Z",
  url: "https://github.com/francemazzi/octo_core/releases/tag/v1.2.0",
  assets: [
    "OctoCore-1.2.0-mac-arm64.dmg",
    "OctoCore-1.2.0-mac-arm64.zip",
    "OctoCore-1.2.0-mac-x64.dmg",
    "OctoCore-1.2.0-win-x64.zip",
    "OctoCore-1.2.0-win-arm64.zip",
    "OctoCore-1.2.0-linux-x64.zip",
    "SHA256SUMS.txt",
  ].map((name) => ({ name, url: `https://example.test/${name}`, size: 1 })),
};

describe("landing page download logic", () => {
  it("recognises computers and leaves phones and tablets without a build", () => {
    expect(detectOs({ userAgentData: { platform: "macOS" } })).toBe("mac");
    expect(
      detectOs({ platform: "MacIntel", userAgent: "Mozilla (Macintosh; Intel Mac OS X)" }),
    ).toBe("mac");
    expect(detectOs({ userAgentData: { platform: "Windows" }, userAgent: "" })).toBe("win");
    expect(detectOs({ platform: "Linux x86_64", userAgent: "Mozilla (X11; Linux x86_64)" })).toBe(
      "linux",
    );
    expect(
      detectOs({ platform: "MacIntel", userAgent: "Mozilla (Macintosh)", maxTouchPoints: 5 }),
    ).toBeNull();
    expect(
      detectOs({ platform: "Linux armv8l", userAgent: "Mozilla (Linux; Android 14)" }),
    ).toBeNull();
    expect(
      detectOs({ platform: "iPhone", userAgent: "Mozilla (iPhone; CPU iPhone OS 18)" }),
    ).toBeNull();
  });

  it("reads the chip from client hints, the user agent or the GPU, and admits when it guesses", async () => {
    const chromeArm = {
      userAgentData: {
        platform: "macOS",
        getHighEntropyValues: async () => ({ architecture: "arm", bitness: "64" }),
      },
    };
    expect(await detectArch(chromeArm, "mac")).toEqual({ arch: "arm64", certain: true });
    const chromeIntel = {
      userAgentData: {
        platform: "Windows",
        getHighEntropyValues: async () => ({ architecture: "x86" }),
      },
    };
    expect(await detectArch(chromeIntel, "win")).toEqual({ arch: "x64", certain: true });
    expect(await detectArch({ userAgent: "Mozilla (Windows NT 10.0; ARM64)" }, "win")).toEqual({
      arch: "arm64",
      certain: true,
    });
    expect(await detectArch({ userAgent: "Mozilla (X11; Linux x86_64)" }, "linux")).toEqual({
      arch: "x64",
      certain: true,
    });
    const safari = { userAgent: "Mozilla (Macintosh; Intel Mac OS X 10_15_7) Safari" };
    expect(await detectArch(safari, "mac", () => "Apple GPU")).toEqual({
      arch: "arm64",
      certain: false,
    });
    expect(await detectArch(safari, "mac", () => "Apple M2")).toEqual({
      arch: "arm64",
      certain: true,
    });
    expect(await detectArch(safari, "mac", () => "Intel Iris Pro OpenGL Engine")).toEqual({
      arch: "x64",
      certain: true,
    });
  });

  it("maps assets to targets, prefers the dmg on macOS and offers the other chip", () => {
    expect(targetOf("OctoCore-1.2.0-mac-arm64.dmg")).toBe("mac-arm64");
    expect(targetOf("OctoCore-1.2.0-mac-arm64.zip")).toBeNull();
    expect(targetOf("OctoCore-1.2.0-win-x64.zip")).toBe("win-x64");
    expect(targetOf("SHA256SUMS.txt")).toBeNull();
    expect(Object.keys(assetsByTarget(release)).sort()).toEqual([
      "linux-x64",
      "mac-arm64",
      "mac-x64",
      "win-arm64",
      "win-x64",
    ]);
    expect(pickAsset(release, "mac", "arm64")?.asset.name).toBe("OctoCore-1.2.0-mac-arm64.dmg");
    expect(pickAsset(release, "linux", "arm64")).toBeNull();
    expect(pickAsset(release, null, "x64")).toBeNull();
    expect(alternateTarget("mac-arm64")).toBe("mac-x64");
    expect(alternateTarget("win-x64")).toBe("win-arm64");
  });

  it("labels buttons in both languages and orders versions", () => {
    expect(downloadLabel("mac-arm64", "it")).toBe("Scarica per macOS (Apple Silicon)");
    expect(downloadLabel("win-arm64", "en")).toBe("Download for Windows (ARM64)");
    expect(downloadLabel(null, "en")).toBe("Download");
    expect(compareVersions("1.10.0", "1.9.3")).toBeGreaterThan(0);
    expect(compareVersions("v1.2.0", "1.2.0")).toBe(0);
    expect(
      fromGithubRelease({
        tag_name: "v1.3.0",
        published_at: "2026-11-01T00:00:00Z",
        assets: [{ name: "OctoCore-1.3.0-mac-arm64.dmg", browser_download_url: "u", size: 5 }],
      }),
    ).toMatchObject({
      version: "1.3.0",
      assets: [{ name: "OctoCore-1.3.0-mac-arm64.dmg", size: 5 }],
    });
    expect(fromGithubRelease({ tag_name: "v1.3.0", prerelease: true, assets: [] })).toBeNull();
  });
});
