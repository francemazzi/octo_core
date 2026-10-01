import { randomBytes } from "node:crypto";
import { OctoError } from "../errors.js";

export interface KeyProvider {
  readonly available: boolean;
  getDataKey(): Buffer;
}

export class InMemoryKeyProvider implements KeyProvider {
  readonly available = true;

  constructor(private readonly key: Buffer = randomBytes(32)) {}

  getDataKey(): Buffer {
    return this.key;
  }
}

export class UnavailableKeyProvider implements KeyProvider {
  readonly available = false;

  getDataKey(): Buffer {
    throw new OctoError("keystore_unavailable", "recording cannot start without a keystore");
  }
}
