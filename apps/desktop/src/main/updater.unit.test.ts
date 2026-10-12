import { describe, expect, it } from "vitest";
import { isNewer, pickAsset } from "./updater.js";

describe("updater", () => {
  it("compares versions numerically", () => {
    expect(isNewer("v1.1.2", "1.1.1")).toBe(true);
    expect(isNewer("1.10.0", "1.9.0")).toBe(true);
    expect(isNewer("v1.1.1", "1.1.1")).toBe(false);
    expect(isNewer("1.0.9", "1.1.0")).toBe(false);
  });

  it("picks the dmg on macOS and the zip elsewhere", () => {
    const assets = [
      "OctoCore-1.2.0-mac-arm64.dmg",
      "OctoCore-1.2.0-mac-arm64.zip",
      "OctoCore-1.2.0-win-x64.zip",
      "OctoCore-1.2.0-linux-x64.zip",
    ].map((name) => ({ name, browser_download_url: `https://github.com/x/${name}` }));
    expect(pickAsset(assets, "darwin", "arm64")?.name).toBe("OctoCore-1.2.0-mac-arm64.dmg");
    expect(pickAsset(assets, "win32", "x64")?.name).toBe("OctoCore-1.2.0-win-x64.zip");
    expect(pickAsset(assets, "darwin", "x64")).toBeUndefined();
  });
});
