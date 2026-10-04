import { describe, expect, it } from "vitest";
import { mascotBounds } from "./mascot-layout.js";

describe("mascot layout", () => {
  it("sits in the top-right corner of the work area, below the menu bar", () => {
    expect(mascotBounds({ x: 0, y: 33, width: 1728, height: 1032 })).toEqual({
      x: 1728 - 156 - 8,
      y: 41,
      width: 156,
      height: 84,
    });
  });

  it("follows a primary display that does not start at the origin", () => {
    expect(
      mascotBounds({ x: -2560, y: 0, width: 2560, height: 1400 }, { width: 100, height: 50 }, 10),
    ).toEqual({ x: -110, y: 10, width: 100, height: 50 });
    expect(mascotBounds({ x: 1920.5, y: 0, width: 1280, height: 720 }).x).toBe(3037);
  });
});
