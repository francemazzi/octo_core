import { existsSync, readFileSync } from "node:fs";
import {
  remoteSettingsSchema,
  legacyRemoteSettingsSchema,
  type RemoteSettingsFile as SettingsFile,
  type RemoteProvider,
} from "@octo/contracts";
import { writeFileAtomic } from "./atomic-file.js";

export interface SecretBox {
  problem(): string | null;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}
export type RemoteSetting = { apiKey: string; model?: string; workspaceId?: string };
export type RemoteSummary = {
  configured: boolean;
  hint: string | null;
  model: string | null;
  workspaceId?: string;
};
/** Keys remain OS-keystore ciphertext; migration never decrypts the legacy credential. */
export function createSettingsStore(file: string, box: SecretBox) {
  function write(settings: SettingsFile): void {
    writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
  }
  function read(): SettingsFile {
    if (!existsSync(file)) return { version: 2, activeProvider: null, providers: {} };
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    const legacy = legacyRemoteSettingsSchema.safeParse(parsed);
    if (legacy.success) {
      const migrated: SettingsFile = {
        version: 2,
        activeProvider: legacy.data.openrouter ? "openrouter" : null,
        providers: { ...(legacy.data.openrouter ? { openrouter: legacy.data.openrouter } : {}) },
      };
      write(migrated);
      return migrated;
    }
    return remoteSettingsSchema.parse(parsed);
  }
  return {
    snapshot: read,
    restore(snapshot: SettingsFile): void {
      if (JSON.stringify(read()) !== JSON.stringify(snapshot)) write(snapshot);
    },
    problem: () => box.problem(),
    active: () => read().activeProvider,
    select(provider: RemoteProvider): void {
      write({ ...read(), activeProvider: provider });
    },
    summary(provider: RemoteProvider): RemoteSummary {
      const stored = read().providers[provider];
      return {
        configured: stored !== undefined,
        hint: stored?.hint ?? null,
        model: stored?.model ?? null,
        ...(stored?.workspaceId ? { workspaceId: stored.workspaceId } : {}),
      };
    },
    credential(provider: RemoteProvider): RemoteSetting | null {
      const stored = read().providers[provider];
      if (!stored || box.problem()) return null;
      return {
        apiKey: box.decrypt(Buffer.from(stored.keyCiphertext, "base64")),
        ...(stored.model ? { model: stored.model } : {}),
        ...(stored.workspaceId ? { workspaceId: stored.workspaceId } : {}),
      };
    },
    save(provider: RemoteProvider, setting: RemoteSetting): void {
      const problem = box.problem();
      if (problem) throw new Error(problem);
      const settings = read();
      settings.providers[provider] = {
        keyCiphertext: box.encrypt(setting.apiKey).toString("base64"),
        hint: setting.apiKey.slice(-4),
        ...(setting.model ? { model: setting.model } : {}),
        ...(setting.workspaceId ? { workspaceId: setting.workspaceId } : {}),
      };
      write(settings);
    },
    remove(provider: RemoteProvider): void {
      const settings = read();
      delete settings.providers[provider];
      write(settings);
    },
  };
}
export type SettingsStore = ReturnType<typeof createSettingsStore>;
