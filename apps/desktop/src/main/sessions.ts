import {
  sessionDetailResultSchema,
  sessionListResultSchema,
  type SessionDetail,
  type SessionListItem,
} from "@octo/contracts";
import type { EngineRequest } from "./engine-client.js";
import { parseId } from "./questions.js";

export async function fetchSessions(request: EngineRequest): Promise<SessionListItem[]> {
  const reply = await request({ cmd: "session.list" });
  return sessionListResultSchema.parse(reply.result).sessions;
}

export async function fetchDetail(
  request: EngineRequest,
  payload: unknown,
): Promise<SessionDetail> {
  const sessionId = parseId(payload, "sessione");
  const reply = await request({ cmd: "session.detail", sessionId });
  return sessionDetailResultSchema.parse(reply.result);
}
