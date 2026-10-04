import type { SessionListItem } from "@octo/contracts";
import { describe, expect, it } from "vitest";
import {
  defaultSelection,
  formatDuration,
  groupSessionsByDay,
  sessionTitle,
  statusChip,
} from "./session-format.js";

function session(id: string, started: Date, patch: Partial<SessionListItem> = {}): SessionListItem {
  return {
    sessionId: id,
    title: null,
    startedWall: started.toISOString(),
    endedWall: null,
    captureState: "stopped",
    analysisState: "pending",
    durationMs: 0,
    episodeCount: 0,
    openQuestionCount: 0,
    sourceIds: ["mon-1"],
    ...patch,
  };
}

describe("session format", () => {
  const now = new Date(2026, 9, 4, 10, 0);

  it("groups sessions by local day with Oggi, Ieri, and the Italian date", () => {
    const groups = groupSessionsByDay(
      [
        session("a", new Date(2026, 9, 4, 9, 30)),
        session("b", new Date(2026, 9, 4, 0, 5)),
        session("c", new Date(2026, 9, 3, 23, 55)),
        session("d", new Date(2026, 9, 1, 15, 0)),
        session("e", new Date(2025, 11, 31, 8, 0)),
      ],
      now,
    );
    expect(
      groups.map((group) => [group.label, group.sessions.map((item) => item.sessionId)]),
    ).toEqual([
      ["Oggi", ["a", "b"]],
      ["Ieri", ["c"]],
      ["Giovedì 1 ottobre", ["d"]],
      ["Mercoledì 31 dicembre 2025", ["e"]],
    ]);
  });

  it("formats durations and falls back to the start time for untitled sessions", () => {
    expect([30_000, 60_000, 12 * 60_000, 65 * 60_000].map(formatDuration)).toEqual([
      "meno di 1 min",
      "1 min",
      "12 min",
      "1 h 05 min",
    ]);
    expect(sessionTitle(session("a", new Date(2026, 9, 4, 9, 31)))).toBe("Sessione delle 09:31");
    expect(sessionTitle(session("a", now, { title: "Inserimento ordini" }))).toBe(
      "Inserimento ordini",
    );
  });

  it("names the state with words that never match the buttons", () => {
    const at = new Date(2026, 9, 4, 9, 0);
    expect(
      [
        session("r", at, { captureState: "recording" }),
        session("p", at, { captureState: "paused" }),
        session("x", at),
        session("q", at, { openQuestionCount: 1, episodeCount: 2 }),
        session("k", at, { episodeCount: 2, analysisState: "completed" }),
        session("n", at),
      ].map((item) => statusChip(item, "x")),
    ).toEqual(["in corso", "sospesa", "analisi…", "domanda", "pronta", "da analizzare"]);
  });

  it("selects the active session, then one with a question, then the newest", () => {
    const sessions = [
      session("new", now),
      session("asks", now, { openQuestionCount: 1 }),
      session("old", now),
    ];
    expect(defaultSelection(sessions, "live")).toBe("live");
    expect(defaultSelection(sessions, null)).toBe("asks");
    expect(defaultSelection([session("only", now)], null)).toBe("only");
    expect(defaultSelection([], null)).toBeNull();
  });
});
