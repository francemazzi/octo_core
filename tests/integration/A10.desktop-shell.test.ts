import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createEngine } from "@octo/engine";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { describe, expect, it } from "vitest";
import { startDemo } from "../helpers/engine.js";
import { promptAliases } from "../helpers/model-network.js";

/** On a fresh machine `require("electron")` first prints a download notice; the path is last. */
function electronBinary(): string {
  const output = execFileSync("node", ["-e", "process.stdout.write(require('electron'))"], {
    cwd: join(process.cwd(), "apps/desktop"),
    encoding: "utf8",
  });
  return output.trim().split("\n").at(-1) ?? output;
}

function launch(dataDir: string, env: NodeJS.ProcessEnv = {}): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: electronBinary(),
    args: [join(process.cwd(), "apps/desktop")],
    env: {
      ...process.env,
      OCTO_DATA_DIR: dataDir,
      OCTO_CAPTURE: "synthetic",
      OCTO_MODEL: "off",
      OCTO_REPO_ROOT: process.cwd(),
      ...env,
    },
  });
}

type Received = { path: string; authorization: string | undefined; body: string };

/** OpenRouter on this computer: `/key` accepts any key, chat groups every evidence in one activity. */
async function fakeOpenRouter() {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      const path = request.url ?? "";
      received.push({ path, authorization: request.headers.authorization, body });
      response.setHeader("content-type", "application/json");
      if (path.endsWith("/key")) {
        response.end(JSON.stringify({ data: { label: "test" } }));
        return;
      }
      const messages = (JSON.parse(body) as { messages?: Array<{ role: string; content: string }> })
        .messages;
      const prompt = messages?.find((message) => message.role === "user")?.content ?? "";
      const reply = {
        title: "Sessione di prova",
        episodes: [
          {
            episodeId: "lavoro",
            activityType: "order_entry",
            label: "Lavoro di prova",
            evidenceIds: promptAliases(prompt),
          },
        ],
        questions: [],
      };
      response.end(
        JSON.stringify({
          model: "fake/model",
          choices: [{ message: { content: JSON.stringify(reply) } }],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/v1`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function mascotPage(app: ElectronApplication): Promise<Page> {
  await expect
    .poll(() => app.windows().some((window) => window.url().includes("view=mascot")), {
      timeout: 10_000,
    })
    .toBe(true);
  const mascot = app.windows().find((window) => window.url().includes("view=mascot"));
  if (!mascot) throw new Error("mascot window missing");
  return mascot;
}

describe("A10 desktop shell", () => {
  it("pauses from the corner logo, resumes, stops, and lists the session under Oggi", async () => {
    execFileSync("pnpm", ["--filter", "@octo/desktop", "build"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    const dataDir = mkdtempSync(join(tmpdir(), "octo-a10-"));
    const app = await launch(dataDir);
    const page = await app.firstWindow();
    const active = page.getByRole("region", { name: "Sessione attiva" });
    await active.getByText("Nessuna sessione attiva").waitFor();

    const mascot = await mascotPage(app);
    const corner = await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes("view=mascot"),
      );
      return {
        bounds: window?.getBounds(),
        area: screen.getPrimaryDisplay().workArea,
        onTop: window?.isAlwaysOnTop(),
      };
    });
    const bounds = corner.bounds ?? { x: 0, y: 0, width: 0, height: 0 };
    expect(corner.area.x + corner.area.width - (bounds.x + bounds.width)).toBeLessThanOrEqual(24);
    expect(bounds.y - corner.area.y).toBeLessThanOrEqual(24);
    expect(corner.onTop).toBe(true);

    await active.getByRole("checkbox", { name: "Schermo 1" }).check();
    await active.getByRole("button", { name: "Avvia", exact: true }).click();
    await active.getByRole("button", { name: "Pausa", exact: true }).waitFor();

    await mascot.getByRole("button", { name: "Apri Octo" }).hover();
    await mascot.getByRole("button", { name: "Pausa", exact: true }).click();
    await active.getByText("In pausa", { exact: true }).waitFor();
    await active.getByRole("button", { name: "Riprendi", exact: true }).click();
    await active.getByRole("button", { name: "Pausa", exact: true }).waitFor();
    await active.getByRole("button", { name: "Stop", exact: true }).click();
    await active.getByText("Nessuna sessione attiva").waitFor();
    await page.getByRole("navigation", { name: "Sessioni" }).getByText("Oggi").waitFor();
    await app.close();

    const db = new DatabaseSync(join(dataDir, "octo.db"));
    const session = db.prepare("SELECT capture_state FROM sessions").get() as {
      capture_state: string;
    };
    const kinds = (
      db.prepare("SELECT kind FROM capture_events ORDER BY sequence").all() as Array<{
        kind: string;
      }>
    ).map((row) => row.kind);
    const evidence = (
      db.prepare("SELECT start_ms FROM evidence ORDER BY start_ms").all() as Array<{
        start_ms: number;
      }>
    ).map((row) => row.start_ms);
    db.close();
    expect(session.capture_state).toBe("stopped");
    expect(kinds).toEqual(expect.arrayContaining(["paused", "recording", "stopped"]));
    expect(kinds.indexOf("paused")).toBeLessThan(kinds.lastIndexOf("recording"));
    expect(evidence).toEqual([1_000, 2_000]);
  }, 180_000);

  it("opens on the session with a question, shows its activities, and resumes on the answer", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "octo-a10-question-"));
    const seeded = createEngine(dataDir);
    startDemo(seeded);
    seeded.replayCapture();
    seeded.setMono(10_000 + 2_460_000);
    seeded.stopSession();
    expect((await seeded.runAnalysis("local_only")).analysis).toBe("awaiting_answer");
    seeded.close();

    const app = await launch(dataDir);
    const page = await app.firstWindow();
    const mascot = await mascotPage(app);
    await mascot.getByRole("status", { name: "1 domanda in attesa" }).waitFor();

    const detail = page.getByRole("article", { name: "Dettaglio sessione" });
    await detail.getByRole("heading", { name: "Inserimento ordine cliente" }).waitFor();
    await detail.getByText("Risposta a una mail").waitFor();
    const prompt = "Questi passaggi appartengono allo stesso ordine?";
    await page.getByRole("textbox", { name: `Risposta: ${prompt}` }).fill("Sì, stesso ordine");
    await page.getByRole("button", { name: "Rispondi" }).click();
    await page.getByText("Grazie, analisi completata.").waitFor();
    await expect.poll(() => page.getByText(prompt).count()).toBe(0);
    await app.close();

    const db = new DatabaseSync(join(dataDir, "octo.db"));
    const session = db.prepare("SELECT analysis_state FROM sessions").get() as {
      analysis_state: string;
    };
    const answers = db.prepare("SELECT text, status FROM answers").all();
    db.close();
    expect(session.analysis_state).toBe("completed");
    expect(answers).toEqual([{ text: "Sì, stesso ordine", status: "accepted" }]);
  }, 180_000);

  it("keeps the OpenRouter key in the keystore and sends a session only after confirmation", async () => {
    const KEY = "octo-test-key-abcd";
    const ENV_KEY = "octo-env-key-0000";
    const openrouter = await fakeOpenRouter();
    const dataDir = mkdtempSync(join(tmpdir(), "octo-a10-remote-"));
    const env = { OPENROUTER_API_KEY: ENV_KEY, OCTO_OPENROUTER_URL: openrouter.url };
    let secure = false;
    try {
      let app = await launch(dataDir, env);
      let page = await app.firstWindow();
      const active = page.getByRole("region", { name: "Sessione attiva" });
      await active.getByText("Nessuna sessione attiva").waitFor();
      await active.getByRole("checkbox", { name: "Schermo 1" }).check();
      await active.getByRole("button", { name: "Avvia", exact: true }).click();
      // The synthetic frame is taken at 1 s: the session must last longer for it to count.
      await active.getByRole("button", { name: "Pausa", exact: true }).waitFor();
      await page.waitForTimeout(2_500);
      await active.getByRole("button", { name: "Stop", exact: true }).click();
      await active.getByText("Nessuna sessione attiva").waitFor();

      secure = await app.evaluate(
        ({ safeStorage }) =>
          safeStorage.isEncryptionAvailable() &&
          (process.platform !== "linux" ||
            safeStorage.getSelectedStorageBackend() !== "basic_text"),
      );
      await page.getByRole("button", { name: "Impostazioni" }).click();
      const settings = page.getByRole("region", { name: "Impostazioni" });
      await settings.getByLabel("Chiave API OpenRouter").fill(KEY);
      const save = settings.getByRole("button", { name: "Salva" });
      if (secure) {
        await save.click();
        await settings.getByText("Chiave configurata (…abcd)").waitFor();
        expect(readFileSync(join(dataDir, "settings.json"), "utf8")).not.toContain(KEY);
      } else {
        await settings.getByRole("alert").waitFor();
        expect(await save.isDisabled()).toBe(true);
        expect(existsSync(join(dataDir, "settings.json"))).toBe(false);
      }
      await settings.getByRole("button", { name: "Chiudi" }).click();

      const detail = page.getByRole("article", { name: "Dettaglio sessione" });
      await detail.getByRole("button", { name: "Analizza con OpenRouter" }).click();
      const confirm = detail.getByRole("region", { name: "Conferma invio a OpenRouter" });
      await confirm.getByText("testo letto da 1 schermata", { exact: false }).waitFor();
      expect(openrouter.received.some((call) => call.path.endsWith("/chat/completions"))).toBe(
        false,
      );
      await confirm.getByRole("button", { name: "Invia" }).click();
      await page.getByText("Attività riconosciute: 1.", { exact: false }).waitFor();
      await detail.getByText("Lavoro di prova").waitFor();

      if (secure) {
        await app.close();
        app = await launch(dataDir, env);
        page = await app.firstWindow();
        await page.getByRole("button", { name: "Impostazioni" }).click();
        const reopened = page.getByRole("region", { name: "Impostazioni" });
        await reopened.getByText("Chiave configurata (…abcd)").waitFor();
        await reopened.getByRole("button", { name: "Rimuovi" }).click();
        await reopened.getByText("Nessuna chiave configurata.").waitFor();
        expect(readFileSync(join(dataDir, "settings.json"), "utf8")).not.toContain("keyCiphertext");
      }
      await app.close();
    } finally {
      await openrouter.close();
    }

    const db = new DatabaseSync(join(dataDir, "octo.db"));
    const approvals = db
      .prepare("SELECT approved_by, approved_at IS NOT NULL AS dated FROM evidence")
      .all();
    const runs = db.prepare("SELECT provider, data_mode, outcome FROM analysis_runs").all();
    const network = db
      .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'network'")
      .get();
    const stored = JSON.stringify(db.prepare("SELECT * FROM audit_events").all());
    db.close();
    expect(approvals).toEqual([{ approved_by: "operator:op-demo", dated: 1 }]);
    expect(runs).toEqual([
      { provider: "openrouter", data_mode: "cloud_after_review", outcome: "accepted" },
    ]);
    expect(network).toEqual({ count: 1 });
    expect(stored).not.toContain(KEY);
    const chats = openrouter.received.filter((call) => call.path.endsWith("/chat/completions"));
    expect(chats).toHaveLength(1);
    expect(chats[0]?.authorization).toBe(`Bearer ${secure ? KEY : ENV_KEY}`);
    expect(chats[0]?.body).toContain("schermo");
    const keyChecks = openrouter.received.filter((call) => call.path.endsWith("/key"));
    expect(keyChecks).toHaveLength(secure ? 1 : 0);
  }, 240_000);
});
