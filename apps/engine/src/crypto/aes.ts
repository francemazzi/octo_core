import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { OctoError } from "../errors.js";

export type Envelope = {
  iv: string;
  tag: string;
  data: string;
};

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function encryptAesGcm(key: Buffer, plaintext: Buffer): Envelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("base64"), tag: tag.toString("base64"), data: data.toString("base64") };
}

export function decryptAesGcm(key: Buffer, envelope: Envelope): Buffer {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
  } catch {
    throw new OctoError("tampered_ciphertext", "ciphertext authentication failed");
  }
}
