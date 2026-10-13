import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { promptAliases } from "./model-network.js";

type Received = {
  path: string;
  authorization: string | undefined;
  body: string;
  workspace?: string;
};

/** OpenRouter on this computer: `/key` accepts any key, chat groups every evidence in one activity. */
export async function fakeOpenRouter() {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      const path = request.url ?? "";
      received.push({
        path,
        workspace: request.headers["anthropic-workspace-id"] as string | undefined,
        authorization:
          request.headers.authorization ?? (request.headers["x-api-key"] as string | undefined),
        body,
      });
      response.setHeader("content-type", "application/json");
      if (path.endsWith("/key") || path.includes("/models?")) {
        response.end(JSON.stringify({ data: { label: "test" } }));
        return;
      }
      const messages = (JSON.parse(body) as { messages?: Array<{ role: string; content: string }> })
        .messages;
      const prompt = messages?.find((message) => message.role === "user")?.content ?? "";
      const reply = {
        title: "Sessione di prova",
        episodes: [
          {
            episodeId: "lavoro",
            activityType: "order_entry",
            label: "Lavoro di prova",
            evidenceIds: promptAliases(prompt),
          },
        ],
        questions: [],
      };
      if (path.endsWith("/messages")) {
        response.end(
          JSON.stringify({
            model: "claude-test",
            stop_reason: "end_turn",
            content: [{ type: "text", text: JSON.stringify(reply) }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          model: "fake/model",
          choices: [{ message: { content: JSON.stringify(reply) } }],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/v1`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
