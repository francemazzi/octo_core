import { z } from "zod";
import { MAX_CHAT_TEXT_CHARS } from "./limits.js";

/** The modes the assistant may use: the local model, or the remote one over approved evidence. */
export const chatModeSchema = z.enum(["local_only", "cloud_after_review"]);
export type ChatMode = z.infer<typeof chatModeSchema>;

/** What an answer rests on: an activity of the session or one screenshot read as text. */
export const chatCitationSchema = z.object({
  type: z.enum(["episode", "evidence"]),
  id: z.string().min(1).max(100),
  /** Shown in the dashboard: the activity label or the screenshot time ("Schermata +01:40"). */
  label: z.string().nullable(),
});
export type ChatCitation = z.infer<typeof chatCitationSchema>;

export const chatMessageSchema = z.object({
  messageId: z.string(),
  sessionId: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  citations: z.array(chatCitationSchema),
  model: z.string().nullable(),
  promptSchema: z.string().nullable(),
  dataMode: z.string().nullable(),
  /** At least one citation resolved to a real activity or screenshot of the session. */
  verified: z.boolean(),
  /** Only the first batch of evidence reached the model. */
  partial: z.boolean(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatSendResultSchema = z.object({ message: chatMessageSchema });
export const chatHistoryResultSchema = z.object({ messages: z.array(chatMessageSchema) });

const sessionIdSchema = z.string().min(1).max(100);

export const chatSendCommandSchema = z.object({
  v: z.number(),
  id: z.string(),
  cmd: z.literal("chat.send"),
  sessionId: sessionIdSchema,
  text: z.string().min(1).max(MAX_CHAT_TEXT_CHARS),
  mode: chatModeSchema,
});

export const chatHistoryCommandSchema = z.object({
  v: z.number(),
  id: z.string(),
  cmd: z.literal("chat.history"),
  sessionId: sessionIdSchema,
});
