export type MediaFrame = { hash: string };

export class DeterministicMediaEncoder {
  encode(frames: MediaFrame[], finalized: boolean): Uint8Array {
    const lines = [
      "OCTOVID1",
      "audio=none",
      `finalized=${finalized ? "yes" : "no"}`,
      ...frames.map((frame) => frame.hash),
    ];
    return new TextEncoder().encode(`${lines.join("\n")}\n`);
  }
}

export function segmentIsValid(finalized: boolean): boolean {
  return finalized;
}
