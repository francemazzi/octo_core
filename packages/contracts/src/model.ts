import { z } from "zod";

export const MAX_QUESTION_PROMPT_CHARS = 300;

export const modelOutputSchema = z
  .object({
    episodes: z.array(
      z.object({
        episodeId: z.string(),
        activityType: z.string(),
        evidenceIds: z.array(z.string()),
        durationMs: z.number().int().nonnegative().optional(),
      }),
    ),
    questions: z
      .array(
        z.object({
          episodeId: z.string(),
          prompt: z
            .string()
            .min(1)
            .max(MAX_QUESTION_PROMPT_CHARS)
            .regex(/^[^\p{Cc}]+$/u),
          evidenceIds: z.array(z.string()),
        }),
      )
      .max(3)
      .optional(),
  })
  .strict();

export type ModelOutput = z.infer<typeof modelOutputSchema>;
