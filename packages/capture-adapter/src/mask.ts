const SECRET = /SYNTHETIC_SECRET_MARKER/g;

export function maskText(input: string): { text: string; masks: string[] } {
  if (!SECRET.test(input)) return { text: input, masks: [] };
  SECRET.lastIndex = 0;
  return { text: input.replace(SECRET, "[masked]"), masks: ["synthetic_secret"] };
}

export function minimizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}
