import { z } from "zod";

export const timeIntervalSchema = z.object({
  sourceId: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
});

export const assignmentSchema = z.enum(["primary", "secondary", "unknown"]);

export const stretchKindSchema = z.enum(["work", "code_search", "declared_wait", "unknown"]);

export const stretchSchema = z.object({
  id: z.string().min(1),
  episodeId: z.string().min(1).nullable(),
  assignment: assignmentSchema,
  kind: stretchKindSchema,
  intervals: z.array(timeIntervalSchema).min(1),
});

export const sessionOracleSchema = z.object({
  version: z.literal(1),
  session: z.object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    operatorPseudonym: z.string().min(1),
    startedAt: z.string().datetime(),
    policyVersion: z.string().min(1),
    sources: z
      .array(
        z.object({
          id: z.string().min(1),
          kind: z.enum(["monitor", "window"]),
          authorized: z.boolean(),
        }),
      )
      .min(1),
  }),
  stretches: z.array(stretchSchema).min(1),
  secondaryLabels: z.array(stretchSchema),
  expected: z.object({
    episodeDurationMs: z.record(z.string(), z.number().int().nonnegative()),
    declaredWaitMs: z.number().int().nonnegative(),
    unknownMs: z.number().int().nonnegative(),
    humanTotalMs: z.number().int().positive(),
    naiveAuthorizedIntervalSumMs: z.number().int().positive(),
  }),
  frames: z.array(
    z.object({
      id: z.string().min(1),
      sourceId: z.string().min(1),
      offsetMs: z.number().int().nonnegative(),
      payload: z.string(),
    }),
  ),
  events: z.array(
    z.object({
      kind: z.enum(["stream_terminated", "pause", "backpressure"]),
      offsetMs: z.number().int().nonnegative(),
    }),
  ),
  questions: z.array(
    z.object({
      id: z.string().min(1),
      episodeId: z.string().min(1),
      prompt: z.string().min(1),
      evidenceFrameIds: z.array(z.string().min(1)).min(1),
    }),
  ),
});

export type SessionOracle = z.infer<typeof sessionOracleSchema>;
export type OracleStretch = z.infer<typeof stretchSchema>;

export const economicsInputSchema = z.object({
  volumeAnnuo: z.number().nonnegative(),
  quotaCoperta: z.number().nonnegative(),
  tempoPrimaMin: z.number().nonnegative(),
  tempoDopoMin: z.number().nonnegative(),
  costoOrarioEur: z.number().nonnegative(),
  fattoreUtilizzoCapacita: z.number().nonnegative(),
  investimentoEur: z.number().nonnegative(),
  costiRicorrentiAnnuiEur: z.number().nonnegative(),
});

export const economicsOracleSchema = z.object({
  version: z.literal(1),
  inputs: economicsInputSchema,
  expected: z.object({
    orePotenziali: z.number(),
    valoreCapacitaEur: z.number(),
    beneficioNettoAnnuoEur: z.number(),
    roiAnno1: z.number(),
    paybackMesi: z.number(),
  }),
});

export type EconomicsInput = z.infer<typeof economicsInputSchema>;
export type EconomicsOracle = z.infer<typeof economicsOracleSchema>;

export const PROTOCOL_VERSION = 1;

export const engineCommandSchema = z.discriminatedUnion("cmd", [
  z.object({
    v: z.number(),
    id: z.string(),
    cmd: z.literal("handshake"),
    clientVersion: z.number(),
  }),
  z.object({ v: z.number(), id: z.string(), cmd: z.literal("shutdown") }),
  z.object({
    v: z.number(),
    id: z.string(),
    cmd: z.literal("session.start"),
    projectId: z.string(),
    operatorPseudonym: z.string(),
    sourceIds: z.array(z.string()),
    purpose: z.string(),
  }),
  z.object({ v: z.number(), id: z.string(), cmd: z.literal("session.pause") }),
  z.object({ v: z.number(), id: z.string(), cmd: z.literal("session.resume") }),
  z.object({ v: z.number(), id: z.string(), cmd: z.literal("session.stop") }),
  z.object({ v: z.number(), id: z.string(), cmd: z.literal("session.state") }),
  z.object({ v: z.number(), id: z.string(), cmd: z.literal("capture.replay") }),
  z.object({
    v: z.number(),
    id: z.string(),
    cmd: z.literal("capture.frame"),
    frameId: z.string(),
    sourceId: z.string(),
    offsetMs: z.number(),
    payload: z.string(),
  }),
  z.object({
    v: z.number(),
    id: z.string(),
    cmd: z.literal("analysis.run"),
    mode: z.enum(["local_only", "cloud_after_review", "cloud_live_authorized"]),
  }),
  z.object({
    v: z.number(),
    id: z.string(),
    cmd: z.literal("question.answer"),
    questionId: z.string(),
    episodeId: z.string(),
    text: z.string(),
  }),
  z.object({
    v: z.number(),
    id: z.string(),
    cmd: z.literal("question.defer"),
    questionId: z.string(),
  }),
  z.object({
    v: z.number(),
    id: z.string(),
    cmd: z.literal("review.confirm"),
    episodeId: z.string(),
  }),
  z.object({
    v: z.number(),
    id: z.string(),
    cmd: z.literal("review.split"),
    episodeId: z.string(),
    atMs: z.number(),
  }),
  z.object({
    v: z.number(),
    id: z.string(),
    cmd: z.literal("review.merge"),
    episodeId: z.string(),
    intoEpisodeId: z.string(),
  }),
  z.object({
    v: z.number(),
    id: z.string(),
    cmd: z.literal("export.run"),
    destination: z.string(),
    status: z.enum(["draft", "approved"]),
  }),
  z.object({ v: z.number(), id: z.string(), cmd: z.literal("diagnostics.log") }),
  z.object({ v: z.number(), id: z.string(), cmd: z.literal("session.delete") }),
]);

export type EngineCommand = z.infer<typeof engineCommandSchema>;

export const modelOutputSchema = z
  .object({
    episodes: z.array(
      z.object({
        episodeId: z.string(),
        activityType: z.string(),
        evidenceIds: z.array(z.string()),
        durationMs: z.number().int().nonnegative(),
      }),
    ),
  })
  .strict();

export type ModelOutput = z.infer<typeof modelOutputSchema>;
