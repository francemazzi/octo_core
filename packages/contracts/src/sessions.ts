import { z } from "zod";

/** What the desktop sidebar and session view read from the engine; parsed on both sides. */
export const sessionListItemSchema = z.object({
  sessionId: z.string(),
  title: z.string().nullable(),
  startedWall: z.string(),
  endedWall: z.string().nullable(),
  captureState: z.enum(["idle", "recording", "paused", "stopped"]),
  analysisState: z.enum(["idle", "pending", "running", "awaiting_answer", "completed"]),
  durationMs: z.number().int().nonnegative(),
  episodeCount: z.number().int().nonnegative(),
  openQuestionCount: z.number().int().nonnegative(),
  sourceIds: z.array(z.string()),
});

export const sessionListResultSchema = z.object({ sessions: z.array(sessionListItemSchema) });

export const sessionQuestionSchema = z.object({
  questionId: z.string(),
  sessionId: z.string(),
  episodeId: z.string(),
  prompt: z.string(),
  status: z.string(),
  askedAtMs: z.number(),
});

export const questionListResultSchema = z.object({ questions: z.array(sessionQuestionSchema) });

export const sessionEpisodeSchema = z.object({
  episodeId: z.string(),
  label: z.string().nullable(),
  summary: z.string().nullable(),
  activityType: z.string(),
  durationMs: z.number().int().nonnegative(),
  reviewState: z.string(),
});

export const sessionDetailResultSchema = z.object({
  session: sessionListItemSchema,
  episodes: z.array(sessionEpisodeSchema),
  questions: z.array(sessionQuestionSchema),
  lastRun: z
    .object({ outcome: z.string(), model: z.string(), error: z.string().nullable() })
    .nullable(),
});

export type SessionListItem = z.infer<typeof sessionListItemSchema>;
export type SessionQuestion = z.infer<typeof sessionQuestionSchema>;
export type SessionEpisode = z.infer<typeof sessionEpisodeSchema>;
export type SessionDetail = z.infer<typeof sessionDetailResultSchema>;
