import { describe, expect, it } from "vitest";
import { OctoError } from "@octo/engine";
import { startDemo, tempEngine } from "../helpers/engine.js";

describe("A03 sessions schema and clock", () => {
  it("does not duplicate an active session, rejects invalid transitions, and ignores wall-clock rollback", () => {
    const { engine } = tempEngine();
    engine.setMono(1_000);
    const first = startDemo(engine);
    const second = startDemo(engine);
    expect(second.sessionId).toBe(first.sessionId);

    engine.setMono(5_000);
    engine.setWall("2020-01-01T00:00:00.000Z");
    engine.pauseSession();
    expect(engine.durationMs()).toBe(4_000);

    engine.stopSession();
    expect(() => engine.pauseSession()).toThrow(OctoError);

    engine.openEpoch(first.sessionId);
    expect(() => engine.mixedDuration()).toThrow(OctoError);
    engine.close();
  });
});
