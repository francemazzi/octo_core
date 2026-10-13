import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineCommandSchema } from "@octo/contracts";
import { createEngine, dispatch, modelWiring } from "@octo/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialUiState, type UiRemote } from "../shared/ui-state.js";
import { createRemoteModel } from "./remote-model.js";
import { createSettingsStore } from "./settings-store.js";
import { EngineError, type EngineRequest } from "./engine-client.js";

vi.mock("electron", () => ({ app: {} }));
afterEach(() => vi.unstubAllGlobals());
const KEY = "octo-test-key-abcd";
function setup(env: NodeJS.ProcessEnv = { OCTO_MODEL: "off", OPENROUTER_API_KEY: KEY }) {
  const dir = mkdtempSync(join(tmpdir(), "octo-remote-test-"));
  const file = join(dir, "settings.json");
  const store = createSettingsStore(file, {
    problem: () => null,
    encrypt: (text) => Buffer.from(Buffer.from(text).map((byte) => byte ^ 90)),
    decrypt: (data) => Buffer.from(data.map((byte) => byte ^ 90)).toString(),
  });
  const engine = createEngine(dir, modelWiring(env));
  const request: EngineRequest = async (command) => {
    try {
      return {
        ok: true,
        result: await dispatch(engine, engineCommandSchema.parse({ v: 1, id: "test", ...command })),
      };
    } catch (error) {
      throw new EngineError((error as { code: string }).code, "Provider refused request");
    }
  };
  let state: UiRemote = initialUiState.remote;
  let analyzing = false;
  const remote = createRemoteModel({
    request,
    store,
    publish: (next) => {
      state = next;
    },
    analyzing: () => analyzing,
  });
  return {
    remote,
    engine,
    store,
    file,
    state: () => state,
    analyzing: () => {
      analyzing = true;
    },
  };
}

describe("remote settings orchestration", () => {
  it("makes the first key the default when no provider exists, so one key is enough", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [] })),
    );
    const test = setup({ OCTO_MODEL: "off" });
    try {
      await test.remote.boot();
      expect(test.state()).toMatchObject({ provider: null, available: false });
      expect(await test.remote.save({ provider: "anthropic", apiKey: KEY })).toBeNull();
      expect(test.state()).toMatchObject({ provider: "anthropic", available: true });
      expect(test.store.active()).toBe("anthropic");
      expect(await test.remote.save({ provider: "openrouter", apiKey: KEY })).toBeNull();
      expect(test.state().provider).toBe("anthropic");
    } finally {
      test.engine.close();
    }
  });

  it("saves without switching, persists selection, removes without cross-provider fallback", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetchImpl);
    const test = setup();
    try {
      await test.remote.boot();
      expect(
        await test.remote.save({ provider: "anthropic", apiKey: KEY, workspaceId: "wrkspc_test" }),
      ).toBeNull();
      expect(test.state().provider).toBe("openrouter");
      expect(test.state().providers.anthropic.configured).toBe(true);
      expect(await test.remote.select("anthropic")).toBeNull();
      expect(test.state()).toMatchObject({
        provider: "anthropic",
        available: true,
        source: "settings",
        workspaceId: "wrkspc_test",
      });
      expect(test.store.active()).toBe("anthropic");
      await test.remote.boot();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(await test.remote.remove("anthropic")).toBeNull();
      expect(test.state()).toMatchObject({ provider: "anthropic", available: false });
      expect((await test.engine.modelStatus()).remote).toBeNull();
      expect(JSON.stringify(test.state()) + readFileSync(test.file, "utf8")).not.toContain(KEY);
    } finally {
      test.engine.close();
    }
  });
  it("keeps the prior key and selection after failed validation or persistence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}, { status: 401 })),
    );
    const test = setup();
    try {
      test.store.save("openrouter", { apiKey: KEY });
      test.store.select("openrouter");
      await test.remote.boot();
      const before = readFileSync(test.file, "utf8");
      expect(await test.remote.save({ provider: "anthropic", apiKey: KEY })).toContain(
        "Claude (Anthropic) ha rifiutato",
      );
      expect(readFileSync(test.file, "utf8")).toBe(before);
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [] })),
      );
      vi.spyOn(test.store, "save").mockImplementation(() => {
        throw new Error("disk full");
      });
      expect(await test.remote.save({ provider: "anthropic", apiKey: KEY })).toContain("mantenuta");
      expect(readFileSync(test.file, "utf8")).toBe(before);
      expect(test.state().provider).toBe("openrouter");
      expect((await test.engine.modelStatus()).remote?.provider).toBe("openrouter");
    } finally {
      test.engine.close();
    }
  });
  it("refuses provider changes while an analysis is running", async () => {
    const test = setup();
    try {
      await test.remote.boot();
      test.analyzing();
      expect(await test.remote.select("anthropic")).toContain("Attendi");
      expect(test.state().provider).toBe("openrouter");
    } finally {
      test.engine.close();
    }
  });
  it("restores a saved override of an environment key after boot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [] })),
    );
    const test = setup();
    try {
      await test.remote.boot();
      expect(
        await test.remote.save({
          provider: "openrouter",
          apiKey: "octo-new-key-saved",
          model: "vendor/saved",
        }),
      ).toBeNull();
      expect(test.store.active()).toBe("openrouter");
      await test.remote.boot();
      expect(test.state()).toMatchObject({
        provider: "openrouter",
        model: "vendor/saved",
        source: "settings",
      });
    } finally {
      test.engine.close();
    }
  });
});
