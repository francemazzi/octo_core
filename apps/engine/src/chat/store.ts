import { chatCitationSchema, type ChatCitation, type ChatMessage } from "@octo/contracts";
import { z } from "zod";
import type { Sql } from "../storage/db.js";

type Row = {
  id: string;
  session_id: string;
  role: string;
  text: string;
  citations_json: string;
  model: string | null;
  prompt_schema: string | null;
  data_mode: string | null;
  verified: number;
  partial: number;
  created_at: string;
};

const citationsSchema = z.array(chatCitationSchema);

function citationsOf(json: string): ChatCitation[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch {
    return [];
  }
  const parsed = citationsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

function toMessage(row: Row): ChatMessage {
  return {
    messageId: row.id,
    sessionId: row.session_id,
    role: row.role === "assistant" ? "assistant" : "user",
    text: row.text,
    citations: citationsOf(row.citations_json),
    model: row.model,
    promptSchema: row.prompt_schema,
    dataMode: row.data_mode,
    verified: row.verified === 1,
    partial: row.partial === 1,
    createdAt: row.created_at,
  };
}

/** A question and its answer are stored together, or not at all. */
export function insertChatMessages(db: Sql, messages: ChatMessage[]): void {
  const insert = db.prepare(
    `INSERT INTO chat_messages (
      id, session_id, role, text, citations_json, model, prompt_schema, data_mode, verified, partial, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec("BEGIN");
  try {
    for (const message of messages) {
      insert.run(
        message.messageId,
        message.sessionId,
        message.role,
        message.text,
        JSON.stringify(message.citations),
        message.model,
        message.promptSchema,
        message.dataMode,
        message.verified ? 1 : 0,
        message.partial ? 1 : 0,
        message.createdAt,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** The conversation of a session, oldest first; a question always precedes its answer. */
export function listChatMessages(db: Sql, sessionId: string): ChatMessage[] {
  const rows = db
    .prepare("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at, rowid")
    .all(sessionId) as Row[];
  return rows.map(toMessage);
}
