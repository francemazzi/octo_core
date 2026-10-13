import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";

/** On a fresh machine `require("electron")` first prints a download notice; the path is last. */
export function electronBinary(): string {
  const output = execFileSync("node", ["-e", "process.stdout.write(require('electron'))"], {
    cwd: join(process.cwd(), "apps/desktop"),
    encoding: "utf8",
  });
  return output.trim().split("\n").at(-1) ?? output;
}

/**
 * The built desktop (`pnpm --filter @octo/desktop build`) with synthetic capture and the fixture
 * model, so the list «Prima di registrare» is complete; the media key stays in memory because CI
 * has no system keystore.
 */
export async function launch(
  dataDir: string,
  env: NodeJS.ProcessEnv = {},
): Promise<ElectronApplication> {
  const app = await electron.launch({
    executablePath: electronBinary(),
    args: [join(process.cwd(), "apps/desktop")],
    env: {
      ...process.env,
      OCTO_DATA_DIR: dataDir,
      OCTO_CAPTURE: "synthetic",
      OCTO_MODEL: "fixture",
      OCTO_MEDIA_KEY: "memory",
      OCTO_REPO_ROOT: process.cwd(),
      ...env,
    },
  });
  // A loaded CI runner under xvfb can take more than Playwright's 30 s to show a panel.
  app.context().setDefaultTimeout(60_000);
  return app;
}

export function buildDesktop(): void {
  execFileSync("pnpm", ["--filter", "@octo/desktop", "build"], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}
