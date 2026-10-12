import { MAX_CHAT_ANSWER_CHARS, MAX_CHAT_CITATIONS, type ChatCitation } from "@octo/contracts";
import type { ModelEvidence } from "../analysis/model-adapter.js";
import { evidenceResolver } from "../analysis/prompt.js";
import { cleanText } from "../analysis/reply.js";
import { OctoError } from "../errors.js";
import type { ChatEpisodeRef } from "./prompt.js";

export type RawChatCitation = { type?: string; id: string };
export type RawChatReply = { answer?: string; citations: RawChatCitation[] };

export type ValidatedChatReply = {
  answer: string;
  citations: ChatCitation[];
  /** At least one citation points at a real activity or screenshot. */
  verified: boolean;
  issues: { unknownCitations: string[] };
};

const MAX_REPORTED_ISSUES = 10;

function citationOf(item: unknown): RawChatCitation | undefined {
  if (typeof item === "string") return item ? { id: item } : undefined;
  if (typeof item === "number") return { id: String(item) };
  if (typeof item !== "object" || item === null) return undefined;
  const record = item as Record<string, unknown>;
  const id =
    typeof record.id === "string"
      ? record.id
      : typeof record.id === "number"
        ? String(record.id)
        : "";
  if (!id) return undefined;
  return { ...(typeof record.type === "string" ? { type: record.type } : {}), id };
}

/** Tolerant reading of the assistant reply: anything that is not JSON yields an empty reply. */
export function parseChatReply(content: string): RawChatReply {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return { citations: [] };
  let parsed: { answer?: unknown; citations?: unknown };
  try {
    parsed = JSON.parse(content.slice(start, end + 1)) as typeof parsed;
  } catch {
    return { citations: [] };
  }
  const citations = Array.isArray(parsed.citations) ? parsed.citations : [];
  return {
    ...(typeof parsed.answer === "string" ? { answer: parsed.answer } : {}),
    citations: citations.flatMap((item) => {
      const citation = citationOf(item);
      return citation ? [citation] : [];
    }),
  };
}

/** "Schermata +01:40", or "+1:01:40" past the first hour, from the capture offset. */
export function screenLabel(startMs: number): string {
  const total = Math.max(0, Math.floor(startMs / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const clock =
    hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
      : `${String(minutes).padStart(2, "0")}:${seconds}`;
  return `Schermata +${clock}`;
}

/**
 * Keeps only citations that resolve to the evidence sent or to an activity of the session:
 * aliases (`e3`), full ids and episode ids. What does not resolve is listed in `issues`.
 */
export function validateChatReply(
  raw: RawChatReply,
  evidence: ModelEvidence[],
  episodes: ChatEpisodeRef[],
): ValidatedChatReply {
  const answer = cleanText(raw.answer, MAX_CHAT_ANSWER_CHARS);
  if (!answer) throw new OctoError("invalid_model_output", "the assistant returned no answer");
  const resolveEvidence = evidenceResolver(evidence);
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const episodeById = new Map(episodes.map((episode) => [episode.episodeId, episode]));
  const resolve = (citation: RawChatCitation): ChatCitation | undefined => {
    const wanted = citation.type?.toLowerCase();
    if (wanted !== "episode") {
      const id = resolveEvidence(citation.id);
      const item = id ? evidenceById.get(id) : undefined;
      if (item) return { type: "evidence", id: item.id, label: screenLabel(item.startMs) };
    }
    if (wanted !== "evidence") {
      const episode = episodeById.get(citation.id.trim());
      if (episode) {
        return {
          type: "episode",
          id: episode.episodeId,
          label: episode.label ?? episode.activityType,
        };
      }
    }
    return undefined;
  };
  const seen = new Set<string>();
  const citations: ChatCitation[] = [];
  const unknown: string[] = [];
  for (const item of raw.citations) {
    const resolved = resolve(item);
    if (!resolved) {
      unknown.push(item.id.slice(0, 100));
      continue;
    }
    const key = `${resolved.type}:${resolved.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (citations.length < MAX_CHAT_CITATIONS) citations.push(resolved);
  }
  return {
    answer,
    citations,
    verified: citations.length > 0,
    issues: { unknownCitations: unknown.slice(0, MAX_REPORTED_ISSUES) },
  };
}
