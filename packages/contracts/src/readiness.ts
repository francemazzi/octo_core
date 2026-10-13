import { z } from "zod";

/** Real screenshots need OCR on this computer; the synthetic capture of tests and demos does not. */
export const captureModeSchema = z.enum(["screen", "synthetic"]);
export type CaptureMode = z.infer<typeof captureModeSchema>;

/** What must be in place before a recording starts, in the order the dashboard lists it. */
export const readinessRequirementSchema = z.enum([
  "keystore",
  "ollama",
  "ocr_model",
  "analysis_model",
]);
export type ReadinessRequirement = z.infer<typeof readinessRequirementSchema>;

/** The models Octo may download, by role: the engine maps each role to one fixed model name. */
export const pullRoleSchema = z.enum(["ocr", "chat"]);
export type PullRole = z.infer<typeof pullRoleSchema>;

/** OCR failures meaning "this computer is not ready": the only ones that pause a recording. */
export const ocrBlockingErrorSchema = z.enum([
  "ollama_unreachable",
  "ollama_timeout",
  "ocr_model_missing",
  "remote_model",
]);
export type OcrBlockingError = z.infer<typeof ocrBlockingErrorSchema>;

export const pullStateSchema = z.object({
  role: pullRoleSchema,
  model: z.string(),
  status: z.enum(["running", "completed", "failed"]),
  completedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().positive().nullable(),
  error: z.enum(["ollama_unreachable", "pull_failed", "pull_stalled"]).nullable(),
});
export type PullState = z.infer<typeof pullStateSchema>;

export const readinessSchema = z.object({
  capture: captureModeSchema,
  keystore: z.boolean(),
  ollama: z.object({ reachable: z.boolean() }),
  /** `model` is null when this installation reads no screenshots (`OCTO_OCR=off`). */
  ocr: z.object({ model: z.string().nullable(), installed: z.boolean(), local: z.boolean() }),
  localModel: z.string().nullable(),
  remote: z.object({ provider: z.string(), model: z.string().nullable() }).nullable(),
  pullable: z.array(pullRoleSchema),
  pull: pullStateSchema.nullable(),
  missing: z.array(readinessRequirementSchema),
  ready: z.boolean(),
});
export type Readiness = z.infer<typeof readinessSchema>;

/** OCR failures in a row since the last screenshot read; reset by a successful read. */
export const ocrHealthSchema = z.object({
  consecutiveFailures: z.number().int().nonnegative(),
  lastError: ocrBlockingErrorSchema.nullable(),
});
export type OcrHealth = z.infer<typeof ocrHealthSchema>;

export const captureImageResultSchema = z.object({
  accepted: z.boolean(),
  reason: z.string(),
  ocr: ocrHealthSchema,
});
export type CaptureImageResult = z.infer<typeof captureImageResultSchema>;

export const readinessStatusCommandSchema = z.object({
  v: z.number(),
  id: z.string(),
  cmd: z.literal("readiness.status"),
  capture: captureModeSchema,
});

/** Only a role: the model name never comes from the dashboard. */
export const modelPullCommandSchema = z.object({
  v: z.number(),
  id: z.string(),
  cmd: z.literal("model.pull"),
  role: pullRoleSchema,
});

/** The media key, base64 of 32 bytes, unwrapped by the desktop from the system keystore. */
export const keysUnlockCommandSchema = z.object({
  v: z.number(),
  id: z.string(),
  cmd: z.literal("keys.unlock"),
  key: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
});
