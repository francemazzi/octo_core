import { ElectronDesktopCaptureAdapter } from "@octo/capture-adapter";
import { describe, expect, it } from "vitest";
import { tempEngine } from "../helpers/engine.js";

describe("A11 video and capture port", () => {
  it("writes a deterministic container without audio and keeps unfinished segments invalid", async () => {
    const { engine } = tempEngine();
    const unfinished = engine.encodeClip(["frame-hash"], false);
    expect(unfinished.hasAudio).toBe(false);
    expect(unfinished.state).toBe("partial");
    expect(unfinished.bytes).toContain("audio=none");
    expect(unfinished.bytes).toContain("finalized=no");
    const finished = engine.encodeClip(["frame-hash"], true);
    expect(finished.state).toBe("valid");

    const adapter = new ElectronDesktopCaptureAdapter({
      async listSources() {
        return [{ id: "screen:1", name: "Display 1", kind: "monitor" }];
      },
    });
    expect(adapter.name).toBe("electron");
    const sources = await adapter.listSources();
    expect(adapter.capability(sources)).toBe("single_monitor");
    engine.close();
  });
});
