import { randomBytes } from "node:crypto";
import { OctoError } from "../errors.js";

export interface KeyProvider {
  readonly available: boolean;
  getDataKey(): Buffer;
  /** Hands over the key kept by the host (the desktop wraps it with the system keystore). */
  unlock?(key: Buffer): void;
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

/**
 * The media key of the desktop, the same at every start so a session stays readable after a
 * restart. Locked until the desktop unlocks it; a second, different key is refused.
 */
export class HostKeyProvider implements KeyProvider {
  private key: Buffer | null = null;

  get available(): boolean {
    return this.key !== null;
  }

  unlock(key: Buffer): void {
    if (key.length !== 32) throw new OctoError("invalid_key_material", "the media key is 32 bytes");
    if (this.key && !this.key.equals(key)) {
      throw new OctoError("key_already_set", "the media key is already unlocked");
    }
    this.key = Buffer.from(key);
  }

  getDataKey(): Buffer {
    if (!this.key) {
      throw new OctoError("keystore_unavailable", "recording cannot start without a keystore");
    }
    return this.key;
  }
}
