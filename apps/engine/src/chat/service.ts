import { randomUUID } from "node:crypto";
import { MAX_BATCH_EVIDENCE, type ChatMessage, type ChatMode } from "@octo/contracts";
import { planBatches } from "../analysis/batches.js";
import { adapterFor, type InterpretDeps } from "../analysis/interpret.js";
import type { ConverseReply } from "../analysis/model-adapter.js";
import {
  auditNetwork,
  perimeterEvidence,
  toEvidence,
  type EvidenceRow,
} from "../analysis/perimeter.js";
import { recordRun, type RunOutcome } from "../analysis/runs.js";
import { OctoError } from "../errors.js";
import {
  CHAT_PROMPT_SCHEMA,
  CHAT_SYSTEM_PROMPT,
  chatMessages,
  describeSession,
  evidenceBlock,
} from "./prompt.js";
import { parseChatReply, validateChatReply } from "./reply.js";
import { insertChatMessages, listChatMessages } from "./store.js";

export type ChatSendInput = { sessionId: string; text: string; mode: ChatMode };

type ReadableEvidence = {
  rows: EvidenceRow[];
  readText: (assetId: string) => string;
  unreadable: number;
};

/**
 * Evidence whose text can still be read: the media key does not survive a restart, so an older
 * session keeps its activities but loses its screen text. What cannot be read is not sent, and
 * the answer is marked partial.
 */
function readableEvidence(deps: InterpretDeps, batch: EvidenceRow[]): ReadableEvidence {
  const texts = new Map<string, string>();
  const rows = batch.filter((row) => {
    if (!row.asset_id) return true;
    try {
      texts.set(row.asset_id, deps.readText(row.asset_id));
      return true;
    } catch {
      return false;
    }
  });
  return {
    rows,
    readText: (assetId) => texts.get(assetId) ?? "",
    unreadable: batch.length - rows.length,
  };
}

/**
 * The session assistant: one model call per question, over the evidence perimeter of the
 * mode, recorded like an analysis call. Nothing it says changes the activities.
 */
export function createChatService(deps: InterpretDeps) {
  const { db } = deps;

  function stoppedSession(sessionId: string): void {
    const session = db.prepare("SELECT capture_state FROM sessions WHERE id = ?").get(sessionId) as
      { capture_state: string } | undefined;
    if (!session) throw new OctoError("missing_session", sessionId);
    if (session.capture_state !== "stopped") {
      throw new OctoError("session_active", "stop the session before asking the assistant");
    }
  }

  async function send(input: ChatSendInput): Promise<{ message: ChatMessage }> {
    stoppedSession(input.sessionId);
    const adapter = adapterFor(deps.profile, input.mode);
    const converse = adapter?.converse?.bind(adapter);
    if (!adapter || !converse) {
      const code = input.mode === "local_only" ? "model_unavailable" : "remote_unavailable";
      throw new OctoError(code, "no model can answer the assistant");
    }
    const rows = perimeterEvidence(db, adapter, input);
    const plan = planBatches(rows, MAX_BATCH_EVIDENCE, 1);
    const readable = readableEvidence(deps, plan.batches[0] ?? []);
    const coverage = { evidenceTotal: plan.evidenceTotal, evidenceSent: readable.rows.length };
    const partial = coverage.evidenceSent < coverage.evidenceTotal;
    const described = describeSession(db, input.sessionId);
    const evidence = toEvidence(
      { ...deps, readText: readable.readText },
      readable.rows,
      described.text.length,
    );
    const context = `${described.text}\n${evidenceBlock(evidence, coverage)}`;
    const messages = chatMessages(context, listChatMessages(db, input.sessionId), input.text);
    const ids = evidence.map((item) => item.id);
    const record = (
      outcome: RunOutcome,
      model: string,
      extra: Record<string, unknown>,
      usage?: Record<string, number>,
    ) =>
      recordRun(db, {
        sessionId: input.sessionId,
        mode: input.mode,
        model,
        provider: adapter.provider,
        promptSchema: CHAT_PROMPT_SCHEMA,
        outcome,
        at: deps.nowWall(),
        detail: {
          chat: true,
          ...coverage,
          ...(readable.unreadable > 0 ? { unreadable: readable.unreadable } : {}),
          input: ids,
          ...extra,
        },
        usage,
      });
    if (adapter.locality === "remote") auditNetwork(deps, input.sessionId, ids, adapter);

    let reply: ConverseReply;
    try {
      reply = await converse(CHAT_SYSTEM_PROMPT, messages);
    } catch (error) {
      const code = error instanceof OctoError ? error.code : "internal";
      const message = error instanceof Error ? error.message.slice(0, 200) : "";
      record(code === "model_unavailable" ? "unavailable" : "error", "unknown", {
        error: code,
        message,
      });
      throw error;
    }
    let validated;
    try {
      validated = validateChatReply(parseChatReply(reply.content), evidence, described.episodes);
    } catch (error) {
      if (!(error instanceof OctoError)) throw error;
      record("rejected", reply.model, { error: error.code }, reply.usage);
      throw error;
    }
    const createdAt = deps.nowWall();
    const assistant: ChatMessage = {
      messageId: randomUUID(),
      sessionId: input.sessionId,
      role: "assistant",
      text: validated.answer,
      citations: validated.citations,
      model: reply.model,
      promptSchema: CHAT_PROMPT_SCHEMA,
      dataMode: input.mode,
      verified: validated.verified,
      partial,
      createdAt,
    };
    record(
      "accepted",
      reply.model,
      {
        messageId: assistant.messageId,
        ...(validated.issues.unknownCitations.length > 0 ? { issues: validated.issues } : {}),
      },
      reply.usage,
    );
    insertChatMessages(db, [
      {
        messageId: randomUUID(),
        sessionId: input.sessionId,
        role: "user",
        text: input.text,
        citations: [],
        model: null,
        promptSchema: null,
        dataMode: input.mode,
        verified: true,
        partial: false,
        createdAt,
      },
      assistant,
    ]);
    return { message: assistant };
  }

  return {
    send,
    history(sessionId: string): ChatMessage[] {
      return listChatMessages(db, sessionId);
    },
  };
}
