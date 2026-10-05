import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/** Encrypts with the operating system keystore (Electron `safeStorage` in the app). */
export interface SecretBox {
  /** Why a secret cannot be stored safely on this computer, or null. */
  problem(): string | null;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

export type OpenRouterSetting = { apiKey: string; model?: string };

/** What the dashboard may know about the key: never the key itself. */
export type OpenRouterSummary = { configured: boolean; hint: string | null; model: string | null };

type SettingsFile = {
  version: 1;
  openrouter?: { keyCiphertext: string; hint: string; model?: string };
};

const HINT_CHARS = 4;

/**
 * App settings in one JSON file next to the engine data. The OpenRouter key is stored only as
 * keystore ciphertext; the file keeps its last four characters so the dashboard can show them.
 */
export function createSettingsStore(file: string, box: SecretBox) {
  function read(): SettingsFile {
    if (!existsSync(file)) return { version: 1 };
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<SettingsFile>;
    return { version: 1, ...(parsed.openrouter ? { openrouter: parsed.openrouter } : {}) };
  }

  /** Written to a temporary file and renamed, readable by this user only. */
  function write(settings: SettingsFile): void {
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
  }

  return {
    problem: () => box.problem(),
    summary(): OpenRouterSummary {
      const stored = read().openrouter;
      return {
        configured: stored !== undefined,
        hint: stored?.hint ?? null,
        model: stored?.model ?? null,
      };
    },
    readOpenRouter(): OpenRouterSetting | null {
      const stored = read().openrouter;
      if (!stored || box.problem()) return null;
      const apiKey = box.decrypt(Buffer.from(stored.keyCiphertext, "base64"));
      return { apiKey, ...(stored.model ? { model: stored.model } : {}) };
    },
    writeOpenRouter(setting: OpenRouterSetting): void {
      const problem = box.problem();
      if (problem) throw new Error(problem);
      write({
        ...read(),
        openrouter: {
          keyCiphertext: box.encrypt(setting.apiKey).toString("base64"),
          hint: setting.apiKey.slice(-HINT_CHARS),
          ...(setting.model ? { model: setting.model } : {}),
        },
      });
    },
    clearOpenRouter(): void {
      const settings = read();
      delete settings.openrouter;
      write(settings);
    },
  };
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
