import { describe, expect, it } from "vitest";
import { OctoError } from "../errors.js";
import { assertAnalysisTransition, assertCaptureTransition } from "./machine.js";

describe("session state machine", () => {
  it("rejects an invalid capture transition and keeps analysis independent", () => {
    expect(() => assertCaptureTransition("recording", "idle")).toThrow(OctoError);
    expect(() => assertCaptureTransition("stopped", "recording")).toThrow(OctoError);
    expect(() => assertAnalysisTransition("idle", "running")).not.toThrow();
    expect(() => assertAnalysisTransition("completed", "running")).toThrow(OctoError);
  });
});
