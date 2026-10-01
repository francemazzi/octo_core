import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { _electron as electron } from "playwright";
import { describe, expect, it } from "vitest";

function electronBinary(): string {
  return execFileSync("node", ["-e", "process.stdout.write(require('electron'))"], {
    cwd: join(process.cwd(), "apps/desktop"),
    encoding: "utf8",
  });
}

describe("A10 desktop shell", () => {
  it("starts, pauses, and stops through the shell, and closing the app ends the session", async () => {
    execFileSync("pnpm", ["--filter", "@octo/desktop", "build"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    const dataDir = mkdtempSync(join(tmpdir(), "octo-a10-"));
    const app = await electron.launch({
      executablePath: electronBinary(),
      args: [join(process.cwd(), "apps/desktop")],
      env: {
        ...process.env,
        OCTO_DATA_DIR: dataDir,
        OCTO_CAPTURE: "synthetic",
        OCTO_REPO_ROOT: process.cwd(),
      },
    });
    const page = await app.firstWindow();
    await page.getByRole("checkbox", { name: "Schermo 1" }).check();
    await page.getByRole("button", { name: "Avvia" }).click();
    await page.getByRole("button", { name: "Pausa" }).waitFor();
    expect(app.windows().length).toBeGreaterThan(1);
    await page.getByRole("button", { name: "Pausa" }).click();
    await page.getByText("In pausa").waitFor();
    await page.getByRole("button", { name: "Stop" }).click();
    await app.close();

    const db = new DatabaseSync(join(dataDir, "octo.db"));
    const session = db.prepare("SELECT capture_state FROM sessions").get() as {
      capture_state: string;
    };
    const evidence = db.prepare("SELECT start_ms FROM evidence").all() as Array<{
      start_ms: number;
    }>;
    db.close();
    expect(session.capture_state).toBe("stopped");
    expect(evidence.some((item) => item.start_ms >= 999_999)).toBe(false);
    expect(evidence).toHaveLength(1);
  }, 180_000);
});
