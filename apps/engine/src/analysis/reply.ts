import { randomUUID } from "node:crypto";
import {
  MAX_EPISODE_LABEL_CHARS,
  MAX_EPISODE_SUMMARY_CHARS,
  MAX_QUESTION_PROMPT_CHARS,
  MAX_SESSION_TITLE_CHARS,
  type ModelOutput,
} from "@octo/contracts";
import type { KnownActivity, ModelEvidence, ModelReply, ReplyIssues } from "./model-adapter.js";
import { activityResolver, evidenceResolver } from "./prompt.js";

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

type Resolve = (value: string) => string | undefined;
type OutputEpisode = ModelOutput["episodes"][number];

export type NormalizedReply = { output: ModelOutput; issues: ReplyIssues };

/**
 * Resolves evidence through `resolve` (aliases or full ids) and makes episode ids unique across
 * sessions with `suffix`; an episode that `continued` resolves keeps the id of an earlier batch.
 * Nothing the model cited is dropped silently: evidence that does not resolve or sits in two
 * episodes, and questions about an unknown episode, are listed in `issues`.
 */
export function normalizeReply(
  reply: RawReply,
  resolve: Resolve,
  suffix: string,
  continued: Resolve = () => undefined,
): NormalizedReply {
  const issues: ReplyIssues = { unknownEvidence: [], duplicateEvidence: [], orphanQuestions: [] };
  const owner = new Map<string, string>();
  const renamed = new Map<string, string>();
  const episodes = new Map<string, OutputEpisode>();
  const evidenceOf = (values: string[]) =>
    values.flatMap((value) => {
      const id = resolve(value);
      if (!id) issues.unknownEvidence.push(value);
      return id ? [id] : [];
    });

  reply.episodes.forEach((group, index) => {
    const episodeId =
      renamed.get(group.episodeId) ??
      continued(group.episodeId) ??
      `${token(group.episodeId, "ep")}-${index + 1}-${suffix}`;
    const evidenceIds = [...new Set(evidenceOf(group.evidenceIds))].filter((id) => {
      const first = owner.get(id);
      if (first !== undefined && first !== episodeId) issues.duplicateEvidence.push(id);
      return first === undefined;
    });
    if (evidenceIds.length === 0) return;
    for (const id of evidenceIds) owner.set(id, episodeId);
    renamed.set(group.episodeId, episodeId);
    const existing = episodes.get(episodeId);
    if (existing) {
      existing.evidenceIds.push(...evidenceIds);
      return;
    }
    const label = cleanText(group.label, MAX_EPISODE_LABEL_CHARS);
    const summary = cleanText(group.summary, MAX_EPISODE_SUMMARY_CHARS);
    episodes.set(episodeId, {
      episodeId,
      activityType: token(group.activityType, "activity"),
      evidenceIds,
      ...(label ? { label } : {}),
      ...(summary ? { summary } : {}),
    });
  });

  const questions = reply.questions
    .flatMap((question) => {
      const episodeId = renamed.get(question.episodeId) ?? continued(question.episodeId);
      const prompt = cleanText(question.prompt, MAX_QUESTION_PROMPT_CHARS);
      if (!episodeId) issues.orphanQuestions.push(question.episodeId);
      if (!episodeId || !prompt) return [];
      return [{ episodeId, prompt, evidenceIds: evidenceOf(question.evidenceIds) }];
    })
    .slice(0, MAX_QUESTIONS);
  const title = cleanText(reply.title, MAX_SESSION_TITLE_CHARS);
  return {
    output: { ...(title ? { title } : {}), episodes: [...episodes.values()], questions },
    issues,
  };
}

/** Model text to a normalized reply, shared by every adapter that talks to a real model. */
export function readReply(
  content: string,
  evidence: ModelEvidence[],
  known: readonly KnownActivity[] = [],
): Pick<ModelReply, "raw" | "issues"> {
  const { output, issues } = normalizeReply(
    parseModelReply(content),
    evidenceResolver(evidence),
    randomUUID().slice(0, 8),
    activityResolver(known),
  );
  return { raw: output, issues };
}
