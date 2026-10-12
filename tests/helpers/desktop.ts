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

/** The built desktop (`pnpm --filter @octo/desktop build`) with synthetic capture and no model. */
export function launch(dataDir: string, env: NodeJS.ProcessEnv = {}): Promise<ElectronApplication> {
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

export function buildDesktop(): void {
  execFileSync("pnpm", ["--filter", "@octo/desktop", "build"], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}
