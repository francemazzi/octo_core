import { z } from "zod";
import { anthropicWorkspaceIdSchema, remoteProviderSchema } from "./oracle.js";
const credentialSchema = z.object({
  keyCiphertext: z.string(),
  hint: z.string(),
  model: z.string().optional(),
  workspaceId: anthropicWorkspaceIdSchema.optional(),
});
export const remoteSettingsSchema = z.object({
  version: z.literal(2),
  activeProvider: remoteProviderSchema.nullable(),
  providers: z.object({
    openrouter: credentialSchema.optional(),
    anthropic: credentialSchema.optional(),
  }),
});
export type RemoteSettingsFile = z.infer<typeof remoteSettingsSchema>;

export const legacyRemoteSettingsSchema = z.object({
  version: z.literal(1),
  openrouter: credentialSchema.optional(),
});
export const remoteAnalysisInputSchema = z.object({
  sessionId: z.string().min(1).max(100),
  provider: remoteProviderSchema,
  model: z.string().min(1).max(120),
  workspaceId: anthropicWorkspaceIdSchema.optional(),
});
