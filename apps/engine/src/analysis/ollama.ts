const DEFAULT_BASE = "http://127.0.0.1:11434";
const PREFERRED_MODELS = [
  "qwen2.5:7b-instruct-q4_K_M",
  "llama3.1:8b",
  "qwen3.5:4b",
  "qwen2.5-coder:1.5b",
];

export type OllamaStatus = { up: boolean; model: string | null };

type FetchLike = typeof fetch;

export function ollamaBase(): string {
  return process.env.OCTO_OLLAMA_URL ?? DEFAULT_BASE;
}

export async function probeOllama(
  fetchImpl: FetchLike = fetch,
  base = ollamaBase(),
): Promise<OllamaStatus> {
  try {
    const response = await fetchImpl(`${base}/api/tags`, { signal: AbortSignal.timeout(800) });
    if (!response.ok) return { up: false, model: null };
    const body = (await response.json()) as {
      models?: Array<{ name?: string; capabilities?: string[] }>;
    };
    const names = (body.models ?? [])
      .filter((model) => model.capabilities?.includes("completion") !== false)
      .map((model) => model.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0)
      .filter((name) => !name.startsWith("bge-") && !name.startsWith("nomic-embed"));
    const requested = process.env.OCTO_OLLAMA_MODEL;
    const preferred = [requested, ...PREFERRED_MODELS].filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    );
    const model =
      preferred
        .map((wanted) => names.find((name) => name === wanted || name.startsWith(`${wanted}:`)))
        .find((name) => name !== undefined) ??
      names[0] ??
      null;
    return { up: model !== null, model };
  } catch {
    return { up: false, model: null };
  }
}

export async function askOllama(
  model: string,
  prompt: string,
  fetchImpl: FetchLike = fetch,
  base = ollamaBase(),
): Promise<string> {
  const response = await fetchImpl(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      messages: [
        {
          role: "system",
          content:
            'Group the evidence lines into work episodes. Return JSON {"episodes":[{"episodeId":"short-id","activityType":"snake_case","evidenceIds":["exact ids from the lines"]}]}. Every evidenceIds value must be copied from the id= field.',
        },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`ollama ${response.status}`);
  const body = (await response.json()) as { message?: { content?: string } };
  const content = body.message?.content;
  if (!content) throw new Error("ollama empty");
  return content;
}

export function parseEpisodeGroups(content: string): Array<{
  episodeId: string;
  activityType: string;
  evidenceIds: string[];
}> {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  const parsed = JSON.parse(content.slice(start, end + 1)) as {
    episodes?: Array<{ episodeId?: unknown; activityType?: unknown; evidenceIds?: unknown }>;
  };
  if (!Array.isArray(parsed.episodes)) return [];
  return parsed.episodes.flatMap((episode) => {
    if (typeof episode.episodeId !== "string" || typeof episode.activityType !== "string") {
      return [];
    }
    const evidenceIds = Array.isArray(episode.evidenceIds)
      ? episode.evidenceIds.filter((id): id is string => typeof id === "string")
      : [];
    return [{ episodeId: episode.episodeId, activityType: episode.activityType, evidenceIds }];
  });
}
