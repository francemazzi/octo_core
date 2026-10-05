import { ANALYSIS_TIMEOUT_MS, type SessionDetail } from "@octo/contracts";
import { initialUiState, type Pending, type UiSource, type UiState } from "../shared/ui-state.js";
import type { EngineRequest } from "./engine-client.js";
import { analysisNote, describeError, PERMISSION_NOTE } from "./notes.js";
import { answerNote, fetchQuestions, parseAnswer, parseId } from "./questions.js";
import type { ScreenCapture } from "./screen-capture.js";
import { fetchDetail, fetchSessions } from "./sessions.js";
import { syntheticFrames } from "./synthetic.js";

/** The desktop asks the local model by default; the remote one only on request, per session. */
export type AnalysisMode = "local_only" | "cloud_after_review";

export type ControlDeps = {
  request: EngineRequest;
  capture: ScreenCapture;
  /** `OCTO_CAPTURE=synthetic` (tests): fixed frames instead of screenshots. */
  synthetic: boolean;
  /** `OCTO_MODEL=off` turns the analysis after Stop off. */
  analyse: boolean;
  sources: () => UiSource[];
  screenAllowed: () => boolean;
  publish: (state: UiState) => void;
};

/**
 * Owns the UI state. Every command shows its pending state at once, ignores double clicks,
 * and reports failures in `state.error` instead of failing silently.
 */
export function createSessionControl(deps: ControlDeps) {
  const state: UiState = { ...initialUiState, sources: deps.sources() };
  let sourceIds: string[] = [];
  const publish = () => deps.publish(state);
  const origin = () => (state.startedWall ? Date.parse(state.startedWall) : Date.now());

  async function refresh(): Promise<void> {
    try {
      state.sessions = await fetchSessions(deps.request);
      state.questions = await fetchQuestions(deps.request);
    } catch (error) {
      state.error = describeError("Aggiornamento non riuscito", error);
    }
  }

  async function transition(pending: Pending, failure: string, work: () => Promise<void>) {
    if (state.pending) return state;
    state.pending = pending;
    state.error = null;
    publish();
    try {
      await work();
    } catch (error) {
      state.error = describeError(failure, error);
    } finally {
      state.pending = null;
      await refresh();
      publish();
    }
    return state;
  }

  /**
   * One analysis at a time. The remote one first approves the evidence of the session, which
   * `cloud_after_review` is the only mode allowed to send.
   */
  async function analyse(sessionId: string, mode: AnalysisMode = "local_only"): Promise<void> {
    if (state.analyzingSessionId) {
      state.error = "Un'altra analisi è in corso: riprova quando finisce.";
      publish();
      return;
    }
    state.analyzingSessionId = sessionId;
    state.error = null;
    state.note = mode === "local_only" ? "Analisi in corso…" : "Analisi con OpenRouter in corso…";
    publish();
    try {
      if (mode === "cloud_after_review") await deps.request({ cmd: "review.approve", sessionId });
      const run = { cmd: "analysis.run", mode, sessionId };
      const reply = await deps.request(run, ANALYSIS_TIMEOUT_MS);
      const report = await deps.request({ cmd: "report.tick" }, 30_000);
      state.note = analysisNote(reply.result, report.result, mode);
    } catch (error) {
      state.note = "";
      state.error = describeError("Analisi non riuscita", error);
    } finally {
      state.analyzingSessionId = null;
      await refresh();
      state.focus = { sessionId, at: Date.now() };
      publish();
    }
  }

  function selectedSources(payload: unknown): string[] {
    const known = new Set(state.sources.map((source) => source.id));
    const ids = Array.isArray(payload)
      ? payload.filter((id): id is string => typeof id === "string" && known.has(id))
      : [];
    if (ids.length === 0) throw new Error("scegli uno schermo");
    return ids;
  }

  return {
    state,
    publish,
    /** After the handshake: load sessions and pause a session a crash left recording. */
    async boot(note: string): Promise<void> {
      state.note = note;
      await refresh();
      const latest = state.sessions[0];
      // A session started from this window while booting is not a leftover of a crash.
      const startedHere = state.activeSessionId !== null || state.pending !== null;
      if (
        !startedHere &&
        (latest?.captureState === "recording" || latest?.captureState === "paused")
      ) {
        if (latest.captureState === "recording") await deps.request({ cmd: "session.pause" });
        state.capture = "paused";
        state.activeSessionId = latest.sessionId;
        state.startedWall = latest.startedWall;
        sourceIds = latest.sourceIds;
        await refresh();
      }
      publish();
    },
    start: (payload: unknown) =>
      transition("starting", "Avvio non riuscito", async () => {
        const ids = selectedSources(payload);
        const reply = await deps.request({
          cmd: "session.start",
          projectId: "desktop",
          operatorPseudonym: "op-demo",
          sourceIds: ids,
          purpose: "Sessione",
        });
        const started = reply.result as { sessionId: string; startedWall: string };
        state.capture = "recording";
        state.activeSessionId = started.sessionId;
        state.startedWall = started.startedWall;
        state.focus = { sessionId: started.sessionId, at: Date.now() };
        sourceIds = ids;
        if (deps.synthetic) {
          await syntheticFrames.afterStart(deps.request, started.sessionId, ids[0] ?? "mon-1");
          return;
        }
        deps.capture.start(ids, origin());
        if (!deps.screenAllowed()) state.note = PERMISSION_NOTE;
      }),
    pause: () =>
      transition("pausing", "Pausa non riuscita", async () => {
        if (state.capture !== "recording") return;
        const settled = deps.capture.stop();
        await deps.request({ cmd: "session.pause" });
        state.capture = "paused";
        await settled;
        if (deps.synthetic && state.activeSessionId) {
          await syntheticFrames.afterPause(deps.request, state.activeSessionId);
        }
      }),
    resume: () =>
      transition("resuming", "Ripresa non riuscita", async () => {
        if (state.capture !== "paused") return;
        await deps.request({ cmd: "session.resume" });
        state.capture = "recording";
        if (deps.synthetic && state.activeSessionId) {
          await syntheticFrames.afterResume(
            deps.request,
            state.activeSessionId,
            sourceIds[0] ?? "mon-1",
          );
        } else if (!deps.synthetic) {
          deps.capture.start(sourceIds, origin());
        }
      }),
    stop: () =>
      transition("stopping", "Stop non riuscito", async () => {
        if (state.capture === "idle") return;
        const sessionId = state.activeSessionId;
        const settled = deps.capture.stop();
        await deps.request({ cmd: "session.stop" });
        state.capture = "idle";
        state.activeSessionId = null;
        state.startedWall = null;
        await settled;
        if (sessionId && deps.analyse) void analyse(sessionId);
      }),
    analyze(payload: unknown): UiState {
      void analyse(parseId(payload, "sessione"));
      return state;
    },
    analyzeRemote(payload: unknown): UiState {
      void analyse(parseId(payload, "sessione"), "cloud_after_review");
      return state;
    },
    async answer(payload: unknown): Promise<UiState> {
      try {
        const reply = await deps.request(
          { cmd: "question.answer", ...parseAnswer(payload) },
          ANALYSIS_TIMEOUT_MS,
        );
        state.note = answerNote(reply.result);
      } catch (error) {
        state.error = describeError("Risposta non salvata", error);
      }
      await refresh();
      publish();
      return state;
    },
    async defer(payload: unknown): Promise<UiState> {
      try {
        await deps.request({ cmd: "question.defer", questionId: parseId(payload) });
      } catch (error) {
        state.error = describeError("Rinvio non riuscito", error);
      }
      await refresh();
      publish();
      return state;
    },
    detail: (payload: unknown): Promise<SessionDetail> => fetchDetail(deps.request, payload),
    focus(sessionId: string | null): void {
      state.focus = { sessionId, at: Date.now() };
      publish();
    },
    reportCaptureError(message: string): void {
      state.error = deps.screenAllowed() ? message : PERMISSION_NOTE;
      publish();
    },
    /** Quitting stops the session but never waits for an analysis; it can run later. */
    async quit(): Promise<void> {
      if (state.capture === "idle") return;
      await deps.capture.stop();
      await deps.request({ cmd: "session.stop" });
      state.capture = "idle";
    },
  };
}

export type SessionControl = ReturnType<typeof createSessionControl>;
