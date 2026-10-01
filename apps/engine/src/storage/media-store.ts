import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decryptAesGcm, encryptAesGcm, sha256, type Envelope } from "../crypto/aes.js";
import type { KeyProvider } from "../crypto/key-provider.js";
import type { Sql } from "./db.js";

export class MediaStore {
  constructor(
    private readonly db: Sql,
    private readonly dataDir: string,
    private readonly keys: KeyProvider,
  ) {
    mkdirSync(join(dataDir, "media"), { recursive: true });
  }

  begin(sessionId: string, plaintext: Buffer): { assetId: string } {
    const assetId = randomUUID();
    const partialPath = join(this.dataDir, "media", `${assetId}.partial`);
    const envelope = encryptAesGcm(this.keys.getDataKey(), plaintext);
    writeFileSync(partialPath, JSON.stringify(envelope));
    this.db
      .prepare(
        `INSERT INTO assets (id, session_id, hash, state, path, byte_length)
         VALUES (?, ?, ?, 'partial', ?, ?)`,
      )
      .run(assetId, sessionId, sha256(plaintext), partialPath, plaintext.byteLength);
    return { assetId };
  }

  abort(assetId: string): void {
    const row = this.db.prepare("SELECT state FROM assets WHERE id = ?").get(assetId) as
      { state: string } | undefined;
    if (!row) throw new Error(`missing asset ${assetId}`);
    this.db.prepare("UPDATE assets SET state = 'partial' WHERE id = ?").run(assetId);
  }

  commit(assetId: string): void {
    const row = this.db.prepare("SELECT path FROM assets WHERE id = ?").get(assetId) as
      { path: string } | undefined;
    if (!row) throw new Error(`missing asset ${assetId}`);
    const finalPath = row.path.replace(/\.partial$/, ".bin");
    renameSync(row.path, finalPath);
    this.db
      .prepare("UPDATE assets SET state = 'valid', path = ? WHERE id = ?")
      .run(finalPath, assetId);
  }

  readPlaintext(assetId: string): Buffer {
    const row = this.db
      .prepare("SELECT path FROM assets WHERE id = ? AND state = 'valid'")
      .get(assetId) as { path: string } | undefined;
    if (!row) throw new Error(`asset ${assetId} is not valid`);
    const envelope = JSON.parse(readFileSync(row.path, "utf8")) as Envelope;
    return decryptAesGcm(this.keys.getDataKey(), envelope);
  }

  tamper(assetId: string): void {
    const row = this.db.prepare("SELECT path FROM assets WHERE id = ?").get(assetId) as
      { path: string } | undefined;
    if (!row) throw new Error(`missing asset ${assetId}`);
    const envelope = JSON.parse(readFileSync(row.path, "utf8")) as Envelope;
    const bytes = Buffer.from(envelope.data, "base64");
    bytes[0] = bytes[0] === 0 ? 1 : 0;
    envelope.data = bytes.toString("base64");
    writeFileSync(row.path, JSON.stringify(envelope));
  }
}
