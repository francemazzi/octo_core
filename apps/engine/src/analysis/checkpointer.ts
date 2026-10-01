import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  copyCheckpoint,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { Sql } from "../storage/db.js";

type CheckpointRow = {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  type: string | null;
  checkpoint: Uint8Array;
  metadata: Uint8Array;
};

function asBytes(value: Uint8Array | Buffer | string): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export class NodeSqliteSaver extends BaseCheckpointSaver {
  constructor(private readonly db: Sql) {
    super();
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    if (!threadId) return undefined;

    const row = (
      checkpointId
        ? this.db
            .prepare(
              `SELECT * FROM checkpoints
               WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
            )
            .get(threadId, checkpointNs, checkpointId)
        : this.db
            .prepare(
              `SELECT * FROM checkpoints
               WHERE thread_id = ? AND checkpoint_ns = ?
               ORDER BY checkpoint_id DESC LIMIT 1`,
            )
            .get(threadId, checkpointNs)
    ) as CheckpointRow | undefined;
    if (!row) return undefined;

    const writes = this.db
      .prepare(
        `SELECT task_id, channel, type, value FROM writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
      )
      .all(row.thread_id, row.checkpoint_ns, row.checkpoint_id) as Array<{
      task_id: string;
      channel: string;
      type: string;
      value: Uint8Array;
    }>;

    const pendingWrites = await Promise.all(
      writes.map(async (write) => [
        write.task_id,
        write.channel,
        await this.serde.loadsTyped(write.type ?? "json", asBytes(write.value)),
      ]),
    );

    return {
      config: {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.checkpoint_id,
        },
      },
      checkpoint: await this.serde.loadsTyped(row.type ?? "json", asBytes(row.checkpoint)),
      metadata: await this.serde.loadsTyped(row.type ?? "json", asBytes(row.metadata)),
      parentConfig: row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns: row.checkpoint_ns,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined,
      pendingWrites: pendingWrites as CheckpointTuple["pendingWrites"],
    };
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) return;
    const rows = this.db
      .prepare(`SELECT * FROM checkpoints WHERE thread_id = ? ORDER BY checkpoint_id DESC`)
      .all(threadId) as unknown as CheckpointRow[];
    const limited = options?.limit ? rows.slice(0, options.limit) : rows;
    for (const row of limited) {
      const tuple = await this.getTuple({
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.checkpoint_id,
        },
      });
      if (tuple) yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) throw new Error("Missing thread_id");
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const parentId = (config.configurable?.checkpoint_id as string | undefined) ?? null;
    const prepared = copyCheckpoint(checkpoint);
    const [[type, serializedCheckpoint], [, serializedMetadata]] = await Promise.all([
      this.serde.dumpsTyped(prepared),
      this.serde.dumpsTyped(metadata),
    ]);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO checkpoints (
          thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        threadId,
        checkpointNs,
        checkpoint.id,
        parentId,
        type,
        serializedCheckpoint,
        serializedMetadata,
      );
    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    if (!threadId || !checkpointId) throw new Error("Missing thread_id or checkpoint_id");
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const allSpecial = writes.every(([channel]) => channel in WRITES_IDX_MAP);
    const sql = allSpecial
      ? `INSERT OR REPLACE INTO writes (
          thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      : `INSERT OR IGNORE INTO writes (
          thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const stmt = this.db.prepare(sql);
    this.db.exec("BEGIN");
    try {
      for (const [index, write] of writes.entries()) {
        const [type, serialized] = await this.serde.dumpsTyped(write[1]);
        stmt.run(
          threadId,
          checkpointNs,
          checkpointId,
          taskId,
          WRITES_IDX_MAP[write[0]] ?? index,
          write[0],
          type,
          serialized,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    this.db.prepare("DELETE FROM checkpoints WHERE thread_id = ?").run(threadId);
    this.db.prepare("DELETE FROM writes WHERE thread_id = ?").run(threadId);
  }
}
