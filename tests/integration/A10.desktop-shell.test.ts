import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createEngine } from "@octo/engine";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { describe, expect, it } from "vitest";
import { startDemo } from "../helpers/engine.js";

/** On a fresh machine `require("electron")` first prints a download notice; the path is last. */
function electronBinary(): string {
  const output = execFileSync("node", ["-e", "process.stdout.write(require('electron'))"], {
    cwd: join(process.cwd(), "apps/desktop"),
    encoding: "utf8",
  });
  return output.trim().split("\n").at(-1) ?? output;
}

function launch(dataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: electronBinary(),
    args: [join(process.cwd(), "apps/desktop")],
    env: {
      ...process.env,
      OCTO_DATA_DIR: dataDir,
      OCTO_CAPTURE: "synthetic",
      OCTO_MODEL: "off",
      OCTO_REPO_ROOT: process.cwd(),
    },
  });
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
});
