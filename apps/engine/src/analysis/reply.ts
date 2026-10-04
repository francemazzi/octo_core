import {
  MAX_EPISODE_LABEL_CHARS,
  MAX_EPISODE_SUMMARY_CHARS,
  MAX_QUESTION_PROMPT_CHARS,
  MAX_SESSION_TITLE_CHARS,
  type ModelOutput,
} from "@octo/contracts";

const MAX_QUESTIONS = 2;

export type RawReply = {
  title?: string;
  episodes: Array<{
    episodeId: string;
    activityType: string;
    evidenceIds: string[];
    label?: string;
    summary?: string;
  }>;
  questions: Array<{ episodeId: string; prompt: string; evidenceIds: string[] }>;
};

/** Tolerant reading of the model reply: anything that is not JSON yields an empty reply. */
export function parseModelReply(content: string): RawReply {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return { episodes: [], questions: [] };
  let parsed: { title?: unknown; episodes?: unknown; questions?: unknown };
  try {
    parsed = JSON.parse(content.slice(start, end + 1)) as typeof parsed;
  } catch {
    return { episodes: [], questions: [] };
  }
  const items = (value: unknown) =>
    (Array.isArray(value) ? value : []) as Array<Record<string, unknown>>;
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  const ids = (value: unknown) =>
    Array.isArray(value)
      ? value.flatMap((id) =>
          typeof id === "string" ? [id] : typeof id === "number" ? [String(id)] : [],
        )
      : [];
  return {
    title: text(parsed.title),
    episodes: items(parsed.episodes).flatMap((item) =>
      typeof item.episodeId === "string" && typeof item.activityType === "string"
        ? [
            {
              episodeId: item.episodeId,
              activityType: item.activityType,
              evidenceIds: ids(item.evidenceIds),
              label: text(item.label),
              summary: text(item.summary),
            },
          ]
        : [],
    ),
    questions: items(parsed.questions).flatMap((item) =>
      typeof item.episodeId === "string" && typeof item.prompt === "string"
        ? [{ episodeId: item.episodeId, prompt: item.prompt, evidenceIds: ids(item.evidenceIds) }]
        : [],
    ),
  };
}

function token(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Text shown to people: control characters become spaces, whitespace is squeezed, then cut. */
export function cleanText(value: string | undefined, max: number): string | undefined {
  const cleaned = value
    ?.replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return cleaned ? cleaned : undefined;
}

/**
 * Resolves evidence through `resolve` (aliases or full ids), gives each evidence to its first
 * episode, makes episode ids unique across sessions with `suffix`, and remaps question episodes.
 */
export function normalizeReply(
  reply: RawReply,
  resolve: (value: string) => string | undefined,
  suffix: string,
): ModelOutput {
  const assigned = new Set<string>();
  const renamed = new Map<string, string>();
  const evidenceOf = (values: string[]) =>
    values.flatMap((value) => {
      const id = resolve(value);
      return id ? [id] : [];
    });
  const episodes = reply.episodes.flatMap((group, index) => {
    const evidenceIds = evidenceOf(group.evidenceIds).filter((id) => !assigned.has(id));
    if (evidenceIds.length === 0) return [];
    for (const id of evidenceIds) assigned.add(id);
    const episodeId = `${token(group.episodeId, "ep")}-${index + 1}-${suffix}`;
    if (!renamed.has(group.episodeId)) renamed.set(group.episodeId, episodeId);
    const label = cleanText(group.label, MAX_EPISODE_LABEL_CHARS);
    const summary = cleanText(group.summary, MAX_EPISODE_SUMMARY_CHARS);
    return [
      {
        episodeId,
        activityType: token(group.activityType, "activity"),
        evidenceIds,
        ...(label ? { label } : {}),
        ...(summary ? { summary } : {}),
      },
    ];
  });
  const questions = reply.questions
    .flatMap((question) => {
      const episodeId = renamed.get(question.episodeId);
      const prompt = cleanText(question.prompt, MAX_QUESTION_PROMPT_CHARS);
      if (!episodeId || !prompt) return [];
      return [{ episodeId, prompt, evidenceIds: evidenceOf(question.evidenceIds) }];
    })
    .slice(0, MAX_QUESTIONS);
  const title = cleanText(reply.title, MAX_SESSION_TITLE_CHARS);
  return { ...(title ? { title } : {}), episodes, questions };
}
