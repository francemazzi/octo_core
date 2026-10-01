import type { SessionOracle } from "@octo/contracts";
import type { CaptureAdapter, CaptureFrame, CaptureGap } from "./types.js";

export class SyntheticCaptureAdapter implements CaptureAdapter {
  readonly name = "synthetic";

  constructor(private readonly oracle: SessionOracle) {}

  frames(): CaptureFrame[] {
    return this.oracle.frames.map((frame) => ({
      id: frame.id,
      sourceId: frame.sourceId,
      offsetMs: frame.offsetMs,
      payload: frame.payload,
    }));
  }

  events(): CaptureGap[] {
    return this.oracle.events.map((event) => ({ kind: event.kind, offsetMs: event.offsetMs }));
  }

  authorizedSourceIds(selected: ReadonlySet<string>): Set<string> {
    return new Set(
      this.oracle.session.sources
        .filter((source) => source.authorized && selected.has(source.id))
        .map((source) => source.id),
    );
  }
}
