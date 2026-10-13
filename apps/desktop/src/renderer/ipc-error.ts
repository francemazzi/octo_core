/** Electron wraps a failure of main as "Error invoking remote method 'octo:…': Error: …". */
const IPC_PREFIX = /^Error invoking remote method '[^']*': (?:\w*Error: )?/;

/** The sentence main wrote, without Electron's wrapper; a fixed sentence when there is none. */
export function failureMessage(failure: unknown): string {
  if (!(failure instanceof Error)) return "Operazione non riuscita.";
  const message = failure.message.replace(IPC_PREFIX, "").trim();
  return message.length > 0 ? message : "Operazione non riuscita.";
}
