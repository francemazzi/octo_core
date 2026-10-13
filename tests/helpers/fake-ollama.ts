import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { promptAliases } from "./model-network.js";

type Tag = { name: string; remote_host?: string };

export type FakeOllamaState = {
  /** Closed: every request loses its connection, like a daemon that is not running. */
  down: boolean;
  tags: Tag[];
  /** Models asked through `/api/pull`, in order. */
  pulls: string[];
  /** The next downloads answer with an error line. */
  failPull: boolean;
  /** Text read from any screenshot. */
  ocrText: string;
};

function line(response: ServerResponse, chunk: unknown): void {
  response.write(`${JSON.stringify(chunk)}\n`);
}

function tagName(model: string): string {
  return model.includes(":") ? model : `${model}:latest`;
}

/**
 * Ollama on this computer for desktop and engine processes, which `fetch` stubs cannot reach.
 * A download streams half its bytes, waits on `hold()` if set, then completes and installs.
 */
export async function fakeOllama(initial: Partial<FakeOllamaState> = {}) {
  const state: FakeOllamaState = {
    down: false,
    tags: [],
    pulls: [],
    failPull: false,
    ocrText: "Ordine 1001 cliente Rossi",
    ...initial,
  };
  let gate: Promise<void> | null = null;

  async function pull(model: string, response: ServerResponse): Promise<void> {
    state.pulls.push(model);
    response.setHeader("content-type", "application/x-ndjson");
    line(response, { status: "pulling manifest" });
    if (state.failPull) {
      line(response, { error: "pull model manifest: file does not exist" });
      response.end();
      return;
    }
    const digest = `sha256:${model}`;
    line(response, { status: `pulling ${digest}`, digest, total: 1_000, completed: 500 });
    if (gate) await gate;
    line(response, { status: `pulling ${digest}`, digest, total: 1_000, completed: 1_000 });
    line(response, { status: "verifying sha256 digest" });
    if (!state.tags.some((tag) => tag.name === tagName(model))) {
      state.tags.push({ name: tagName(model) });
    }
    line(response, { status: "success" });
    response.end();
  }

  function chat(body: string, response: ServerResponse): void {
    const parsed = JSON.parse(body) as {
      messages?: Array<{ role: string; content: string; images?: string[] }>;
    };
    const user = parsed.messages?.find((message) => message.role === "user");
    if (user?.images) {
      line(response, { message: { content: state.ocrText } });
      line(response, { done: true });
      response.end();
      return;
    }
    const reply = {
      title: "Sessione di prova",
      episodes: [
        {
          episodeId: "lavoro",
          activityType: "order_entry",
          label: "Lavoro di prova",
          evidenceIds: promptAliases(user?.content ?? ""),
        },
      ],
      questions: [],
    };
    response.end(JSON.stringify({ message: { content: JSON.stringify(reply) } }));
  }

  const server = createServer((request, response) => {
    if (state.down) {
      request.socket.destroy();
      return;
    }
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      const path = request.url ?? "";
      if (path === "/api/tags") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ models: state.tags }));
        return;
      }
      if (path === "/api/pull") {
        void pull((JSON.parse(body) as { model: string }).model, response);
        return;
      }
      if (path === "/api/chat") {
        chat(body, response);
        return;
      }
      response.statusCode = 404;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    /** Holds every download at half its bytes until the returned function is called. */
    hold(): () => void {
      let release!: () => void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        gate = null;
        release();
      };
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export type FakeOllama = Awaited<ReturnType<typeof fakeOllama>>;
