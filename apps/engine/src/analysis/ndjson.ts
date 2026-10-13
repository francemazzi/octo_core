/**
 * Newline-delimited JSON as Ollama streams it: one trimmed, non-empty line at a time. An abort
 * of `signal` ends the stream even when the body itself never closes.
 */
export async function* ndjsonLines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  signal?.addEventListener("abort", () => void reader.cancel().catch(() => undefined), {
    once: true,
  });
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end = buffer.indexOf("\n");
    while (end >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line.length > 0) yield line;
      end = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim().length > 0) yield buffer.trim();
}
