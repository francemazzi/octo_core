import type { EngineRequest } from "./engine-client.js";

/**
 * Test-only frames for `OCTO_CAPTURE=synthetic`: one after start, one sent while paused (the
 * engine must drop it), one after resume. Ids carry the session so a second session never collides.
 */
export const syntheticFrames = {
  afterStart: (request: EngineRequest, sessionId: string, sourceId: string) =>
    request({
      cmd: "capture.frame",
      frameId: `${sessionId}-live`,
      sourceId,
      offsetMs: 1_000,
      payload: "schermo",
    }),
  afterPause: (request: EngineRequest, sessionId: string) =>
    request({
      cmd: "capture.frame",
      frameId: `${sessionId}-after-pause`,
      sourceId: "mon-1",
      offsetMs: 999_999,
      payload: "dopo-pausa",
    }),
  afterResume: (request: EngineRequest, sessionId: string, sourceId: string) =>
    request({
      cmd: "capture.frame",
      frameId: `${sessionId}-after-resume`,
      sourceId,
      offsetMs: 2_000,
      payload: "dopo-ripresa",
    }),
};
