import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine, frameTimeline, type Engine, type ModelAdapter } from "@octo/engine";
import type { ElectronApplication, Page } from "playwright";
import { buildDesktop, launch } from "../../tests/helpers/desktop.js";
import { startDemo } from "../../tests/helpers/engine.js";

/**
 * Screenshots for the landing page, taken from the real desktop app on synthetic sessions:
 * invented screen text, a simulated model that groups it, no real data. Output: site/assets.
 */
const OUT = join(process.cwd(), "site", "assets");
const FRAME_MS = 30_000;
const FRAMES = 50;
const SESSION_MS = FRAMES * FRAME_MS + 60_000;
const WINDOW = { width: 1280, height: 800 };

const ASSISTANT_ANSWER = {
  answer:
    "Hai dedicato 20 minuti all'inserimento dell'ordine 4521 di Rossi S.r.l., compresa la ricerca del codice articolo VT-220 che hai confermato come parte dello stesso ordine. Nel mezzo hai risposto per 5 minuti alla mail del fornitore sui tempi di consegna.",
  citations: [
    { type: "episode", id: "ordine-1" },
    { type: "episode", id: "mail-1" },
    { type: "evidence", id: "e1" },
    { type: "evidence", id: "e21" },
  ],
};

/** Invented screen text, in the order it would be captured: order, a mail, the order again. */
function screenText(index: number): string {
  if (index >= 20 && index < 30) {
    return `Posta - Fornitore Bianchi Metalli - Oggetto: tempi di consegna lotto 88 - Rispondi - Bozza riga ${index - 19}`;
  }
  const step = index < 20 ? index : index - 10;
  return `Gestionale - Ordini clienti - Ordine n. 4521 - Cliente: Rossi S.r.l. - Articolo VT-220 - Riga ${step + 1} - Quantità 12`;
}

/** A model that always finds the same two activities and asks one question; ids unique per call. */
function syntheticModel(): ModelAdapter {
  let calls = 0;
  return {
    provider: "fixture",
    locality: "local",
    promptSchema: "model-output@2",
    status: () => Promise.resolve({ up: true, model: "mock" }),
    interpret: (evidence) => {
      calls += 1;
      const ids = evidence.map((item) => item.id);
      const mail = ids.filter((_, index) => index >= 20 && index < 30);
      const order = ids.filter((_, index) => index < 20 || index >= 30);
      return Promise.resolve({
        model: "mock",
        raw: {
          title: "Inserimento ordini di giornata",
          episodes: [
            {
              episodeId: `ordine-${calls}`,
              activityType: "order_entry",
              label: "Inserimento ordine cliente Rossi",
              summary:
                "Ordine 4521 inserito nel gestionale riga per riga, con ricerca del codice VT-220.",
              evidenceIds: order,
            },
            {
              episodeId: `mail-${calls}`,
              activityType: "mail",
              label: "Risposta alla mail del fornitore",
              summary: "Risposta al fornitore Bianchi Metalli sui tempi di consegna del lotto 88.",
              evidenceIds: mail,
            },
          ],
          questions: [
            {
              episodeId: `ordine-${calls}`,
              prompt: "La ricerca del codice articolo VT-220 fa parte dello stesso ordine?",
              evidenceIds: ids.slice(35, 36),
            },
          ],
        },
      });
    },
    converse: () => Promise.resolve({ model: "mock", content: JSON.stringify(ASSISTANT_ANSWER) }),
  };
}

async function stoppedSession(
  engine: Engine,
  startMono: number,
  startedAt: Date,
  prefix: string,
): Promise<string> {
  engine.setWall(startedAt.toISOString());
  engine.setMono(startMono);
  const { sessionId } = startDemo(engine);
  for (let index = 0; index < FRAMES; index += 1) {
    engine.ingestFrame({
      frameId: `${prefix}-${index}`,
      sourceId: "mon-1",
      offsetMs: index * FRAME_MS,
      payload: screenText(index),
    });
  }
  engine.setMono(startMono + SESSION_MS);
  engine.setWall(new Date(startedAt.getTime() + SESSION_MS).toISOString());
  engine.stopSession();
  await engine.runAnalysis("local_only");
  return sessionId;
}

/** Two sessions of today: the morning one answered and discussed, the afternoon one with an open question. */
async function seed(dataDir: string): Promise<void> {
  const engine = createEngine(dataDir, {
    analysis: { models: { local: syntheticModel() }, timeline: frameTimeline(60_000) },
  });
  const morning = new Date();
  morning.setHours(9, 5, 0, 0);
  const first = await stoppedSession(engine, 10_000, morning, "am");
  const [question] = engine.openQuestions();
  if (question) {
    await engine.answerQuestion({
      questionId: question.questionId,
      episodeId: question.episodeId,
      text: "Sì, la ricerca del codice fa parte dello stesso ordine.",
    });
  }
  await engine.chatSend({
    sessionId: first,
    text: "Quanto tempo ho dedicato all'ordine e cosa ho fatto nel frattempo?",
    mode: "local_only",
  });
  const afternoon = new Date(morning.getTime() + 5 * 3_600_000);
  await stoppedSession(engine, 9_000_000, afternoon, "pm");
  engine.close();
}

async function resizeDashboard(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents.getURL().includes("view=mascot")) continue;
      window.setSize(size.width, size.height);
      window.center();
    }
  }, WINDOW);
}

async function mascotPage(app: ElectronApplication): Promise<Page> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const page = app.windows().find((window) => window.url().includes("view=mascot"));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("mascot window missing");
}

async function captureOgImage(app: ElectronApplication): Promise<void> {
  const ogPath = join(process.cwd(), "site", "og.html");
  const base64 = await app.evaluate(async ({ BrowserWindow }, file) => {
    const window = new BrowserWindow({ width: 1200, height: 630, frame: false, show: true });
    await window.loadFile(file);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const image = await window.capturePage();
    window.destroy();
    return image.resize({ width: 1200, height: 630 }).toPNG().toString("base64");
  }, ogPath);
  writeFileSync(join(OUT, "og-image.png"), Buffer.from(base64, "base64"));
}

async function main(): Promise<void> {
  buildDesktop();
  mkdirSync(OUT, { recursive: true });
  const dataDir = mkdtempSync(join(tmpdir(), "octo-site-shots-"));
  await seed(dataDir);
  const app = await launch(dataDir, { OCTO_MODEL: "fixture" });
  try {
    const page = await app.firstWindow();
    await resizeDashboard(app);
    const sessions = page.getByRole("navigation", { name: "Sessioni" });
    const rows = sessions.getByRole("button", { name: /Inserimento ordini di giornata/ });
    await rows.nth(1).waitFor();

    // The morning session: activities, the operator's statement and the assistant's answer.
    await rows.nth(1).click();
    const assistant = page.getByRole("region", { name: "Assistente della sessione" });
    await assistant.getByText("Hai dedicato 20 minuti", { exact: false }).waitFor();
    await page.screenshot({ path: join(OUT, "dashboard.png") });
    await assistant.screenshot({ path: join(OUT, "assistant.png") });
    const detail = page.getByRole("article", { name: "Dettaglio sessione" });
    await detail.locator("ol.episodes").screenshot({ path: join(OUT, "activities.png") });

    // The afternoon session still waits for an answer.
    await rows.nth(0).click();
    const questions = page.getByRole("region", { name: "Domande" });
    await questions.getByRole("button", { name: "Rispondi" }).waitFor();
    await questions.screenshot({ path: join(OUT, "questions.png") });

    // A live recording, with the mascot in the corner.
    const active = page.getByRole("region", { name: "Sessione attiva" });
    await active.getByRole("checkbox", { name: "Schermo 1" }).check();
    await active.getByRole("button", { name: "Avvia", exact: true }).click();
    await active.getByText("In registrazione", { exact: true }).waitFor();
    await active.screenshot({ path: join(OUT, "recording.png") });
    const mascot = await mascotPage(app);
    await mascot.screenshot({ path: join(OUT, "mascot.png"), omitBackground: true });
    await active.getByRole("button", { name: "Stop", exact: true }).click();
    await active.getByText("Nessuna sessione attiva").waitFor();

    await captureOgImage(app);
  } finally {
    await app.close();
  }
  process.stdout.write(`screenshots written to ${OUT}\n`);
}

await main();
