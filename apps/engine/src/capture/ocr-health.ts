import { ocrBlockingErrorSchema, type OcrHealth, type RemoteProvider } from "@octo/contracts";
import { OctoError } from "../errors.js";
import { recordAudit } from "../storage/audit.js";
import type { Sql } from "../storage/db.js";

/**
 * Every OCR failure is audited; the ones that mean "this computer is not ready" (Ollama gone,
 * model missing or not local, too slow) are counted in a row so the dashboard can pause the
 * recording instead of keeping time with no screenshots read. A successful read resets the count.
 */
export function createOcrMonitor(deps: {
  db: Sql;
  nowWall: () => string;
  sessionId: () => string | null;
}) {
  let health: OcrHealth = { consecutiveFailures: 0, lastError: null, fallback: null };

  return {
    failed(frameId: string, error: unknown): void {
      const code = error instanceof OctoError ? error.code : "internal";
      recordAudit(deps.db, {
        sessionId: deps.sessionId(),
        at: deps.nowWall(),
        action: "ocr_failed",
        detail: {
          frameId,
          error: code,
          message: error instanceof Error ? error.message.slice(0, 200) : "",
        },
      });
      const blocking = ocrBlockingErrorSchema.safeParse(code);
      if (!blocking.success) return;
      health = {
        consecutiveFailures: health.consecutiveFailures + 1,
        lastError: blocking.data,
        fallback: health.fallback,
      };
    },
    /** A successful read. `via` is set when the configured provider transcribed the screenshot. */
    reset(via: RemoteProvider | null = null): void {
      health = { consecutiveFailures: 0, lastError: null, fallback: via };
    },
    health(): OcrHealth {
      return health;
    },
  };
}

export type OcrMonitor = ReturnType<typeof createOcrMonitor>;
