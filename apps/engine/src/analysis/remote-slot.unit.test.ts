import { describe, expect, it } from "vitest";
import { OctoError } from "../errors.js";
import { createFixtureAdapter } from "./fixture-adapter.js";
import { frameTimeline, type AnalysisProfile } from "./model-adapter.js";
import { createOpenRouterAdapter } from "./openrouter.js";
import { createRemoteSlot, type RemoteModels } from "./remote-slot.js";

const KEY = "octo-test-key-abcd";

function models(verified: string[], refuse = false): RemoteModels {
  return {
    create: (config) => createOpenRouterAdapter({ apiKey: config.apiKey, model: config.model }),
    verify: (config) => {
      verified.push(config.apiKey);
      return refuse
        ? Promise.reject(new OctoError("invalid_key", "OpenRouter refused the key"))
        : Promise.resolve();
    },
  };
}

describe("remote model slot", () => {
  it("swaps the remote model in place and brings back the start one on removal", async () => {
    const atStart = createFixtureAdapter("remote");
    const profile: AnalysisProfile = { models: { remote: atStart }, timeline: frameTimeline(1) };
    const verified: string[] = [];
    const audits: unknown[] = [];
    const slot = createRemoteSlot({
      profile,
      models: models(verified),
      audit: (detail) => audits.push(detail),
    });
    await expect(slot.status()).resolves.toEqual({
      provider: "fixture",
      model: "mock",
      source: "env",
    });

    const configured = await slot.configure({
      remote: { provider: "openrouter", apiKey: KEY, model: "vendor/model" },
      verify: true,
    });
    expect(configured).toEqual({
      provider: "openrouter",
      model: "vendor/model",
      source: "settings",
    });
    expect(profile.models.remote?.provider).toBe("openrouter");
    expect(verified).toEqual([KEY]);

    await expect(slot.configure({ remote: null, verify: false })).resolves.toMatchObject({
      provider: "fixture",
      source: "env",
    });
    expect(profile.models.remote).toBe(atStart);
    expect(JSON.stringify(audits)).not.toContain(KEY);
    expect(audits).toEqual([
      { provider: "openrouter", model: "vendor/model", source: "settings", verified: true },
      { provider: null },
    ]);
  });

  it("keeps the slot unchanged when the key is refused, and empties it when nothing was set", async () => {
    const profile: AnalysisProfile = { models: {}, timeline: frameTimeline(1) };
    const slot = createRemoteSlot({ profile, models: models([], true), audit: () => undefined });
    await expect(
      slot.configure({ remote: { provider: "openrouter", apiKey: KEY }, verify: true }),
    ).rejects.toMatchObject({ code: "invalid_key" });
    expect(profile.models.remote).toBeUndefined();
    await expect(slot.configure({ remote: null, verify: false })).resolves.toBeNull();
    expect("remote" in profile.models).toBe(false);

    const without = createRemoteSlot({ profile, audit: () => undefined });
    await expect(
      without.configure({ remote: { provider: "openrouter", apiKey: KEY }, verify: false }),
    ).rejects.toMatchObject({ code: "remote_unavailable" });
  });

  it("reads screenshots with the key just saved, then with the environment key again", async () => {
    const profile: AnalysisProfile = {
      models: { remote: createOpenRouterAdapter({ apiKey: "env-key-abcdefghij" }) },
      timeline: frameTimeline(1),
    };
    const slot = createRemoteSlot({
      profile,
      models: {
        ...models([]),
        environmentTranscriber: () => ({ provider: "openrouter", transcribe: async () => "env" }),
        transcribe: (config) => ({ provider: config.provider, transcribe: async () => "saved" }),
      },
      audit: () => undefined,
    });
    expect(slot.transcriber()?.provider).toBe("openrouter");
    await slot.configure({ remote: { provider: "anthropic", apiKey: KEY }, verify: false });
    expect(slot.transcriber()?.provider).toBe("anthropic");
    await expect(slot.transcriber()?.transcribe("aW1n")).resolves.toBe("saved");
    await slot.configure({ remote: null, verify: false });
    expect(slot.transcriber()?.provider).toBe("openrouter");
    await expect(slot.transcriber()?.transcribe("aW1n")).resolves.toBe("env");
  });
});
