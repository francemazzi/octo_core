import type { Readiness, ReadinessRequirement } from "@octo/contracts";

export type ReadinessFacts = Pick<
  Readiness,
  "capture" | "keystore" | "ollama" | "ocr" | "localModel" | "remote"
>;

/**
 * What is missing before a recording may start. Real screenshots are useless without OCR on this
 * computer; any recording is useless without a model to analyse it, local or remote.
 */
export function missingRequirements(facts: ReadinessFacts): ReadinessRequirement[] {
  const missing: ReadinessRequirement[] = [];
  if (!facts.keystore) missing.push("keystore");
  if (facts.capture === "screen") {
    if (!facts.ollama.reachable) missing.push("ollama");
    if (!(facts.ocr.model && facts.ocr.installed && facts.ocr.local)) missing.push("ocr_model");
  }
  if (!facts.localModel && !facts.remote) missing.push("analysis_model");
  return missing;
}
