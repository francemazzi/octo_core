import { z } from "zod";

export const MAX_QUESTION_PROMPT_CHARS = 300;
export const MAX_EPISODE_LABEL_CHARS = 80;
export const MAX_EPISODE_SUMMARY_CHARS = 300;
export const MAX_SESSION_TITLE_CHARS = 80;

/** Short text written by a model and shown to people: bounded, no control characters. */
const plainText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]+$/u);

export const modelOutputSchema = z
  .object({
    title: plainText(MAX_SESSION_TITLE_CHARS).optional(),
    episodes: z.array(
      z.object({
        episodeId: z.string(),
        activityType: z.string(),
        evidenceIds: z.array(z.string()),
        durationMs: z.number().int().nonnegative().optional(),
        label: plainText(MAX_EPISODE_LABEL_CHARS).optional(),
        summary: plainText(MAX_EPISODE_SUMMARY_CHARS).optional(),
      }),
    ),
    questions: z
      .array(
        z.object({
          episodeId: z.string(),
          prompt: plainText(MAX_QUESTION_PROMPT_CHARS),
          evidenceIds: z.array(z.string()),
        }),
      )
      .max(3)
      .optional(),
  })
  .strict();

export type ModelOutput = z.infer<typeof modelOutputSchema>;
