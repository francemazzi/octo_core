import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ElectronDesktopCaptureAdapter } from "@octo/capture-adapter";
import { createEngine, OctoError } from "@octo/engine";
import { describe, expect, it, vi } from "vitest";
import { startDemo, tempEngine } from "../helpers/engine.js";

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

  it("reads screenshots in the background and keeps only their text", async () => {
    const globalFetch = vi.fn(() => Promise.reject(new Error("network")));
    vi.stubGlobal("fetch", globalFetch);
    const texts: Record<string, string> = {
      a: "Gestionale: ordine cliente Rossi",
      b: "Gestionale: ordine cliente Rossi",
      c: "Posta: risposta fornitore",
      broken: "",
    };
    const engine = createEngine(mkdtempSync(join(tmpdir(), "octo-a11-ocr-")), {
      ocr: {
        model: "stub-ocr",
        read: async (image) => {
          if (image === "broken") throw new OctoError("ocr_failed", "unreadable");
          return texts[image] ?? "";
        },
      },
    });
    try {
      startDemo(engine);
      const image = (frameId: string, sourceId: string, offsetMs: number, imageBase64: string) =>
        engine.captureImage({ frameId, sourceId, offsetMs, imageBase64 });
      expect(image("scr-1", "mon-1", 0, "a")).toEqual({ accepted: true, reason: "queued" });
      image("scr-2", "mon-1", 30_000, "b");
      image("scr-3", "mon-1", 60_000, "c");
      image("scr-4", "mon-1", 70_000, "broken");
      expect(image("scr-5", "mon-3", 80_000, "a")).toEqual({
        accepted: false,
        reason: "unauthorized",
      });
      await engine.drainCapture();

      const evidence = engine.listEvidence() as Array<{ id: string; asset_id: string }>;
      expect(evidence.map((item) => item.id)).toEqual(["ev-scr-1", "ev-scr-3"]);
      const stored = evidence.map((item) =>
        engine.media.readPlaintext(item.asset_id).toString("utf8"),
      );
      expect(stored).toEqual([texts.a, texts.c]);
      const events = engine.db
        .prepare("SELECT kind FROM capture_events WHERE kind IN ('frame', 'frame_repeat')")
        .all() as Array<{ kind: string }>;
      expect(events.map((event) => event.kind)).toEqual(["frame", "frame_repeat", "frame"]);
      const failures = engine.db
        .prepare("SELECT detail_json FROM audit_events WHERE action = 'ocr_failed'")
        .all() as Array<{ detail_json: string }>;
      expect(failures.map((row) => JSON.parse(row.detail_json) as unknown)).toEqual([
        { frameId: "scr-4", error: "ocr_failed", message: "unreadable" },
      ]);

      engine.pauseSession();
      expect(image("scr-6", "mon-1", 90_000, "c")).toEqual({
        accepted: false,
        reason: "not_recording",
      });
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      engine.close();
      vi.unstubAllGlobals();
    }
  });
});
