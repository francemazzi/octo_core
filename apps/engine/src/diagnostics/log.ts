import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function redactDiagnostic(line: string): string {
  return line
    .replaceAll("SYNTHETIC_SECRET_MARKER", "[redacted]")
    .replace(/data:image\/[a-zA-Z0-9+.;=/-]+/g, "[pixels]");
}

export function diagnosticGuide(): string {
  return "Stop ferma la sessione. Revoca elimina un'evidenza. Annulla ferma un job in coda.";
}

export function writeDiagnostic(dataDir: string, line: string): void {
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(join(dataDir, "diagnostics.log"), `${redactDiagnostic(line)}\n`);
}

export function readDiagnostic(dataDir: string): string {
  try {
    return readFileSync(join(dataDir, "diagnostics.log"), "utf8");
  } catch {
    return "";
  }
}
