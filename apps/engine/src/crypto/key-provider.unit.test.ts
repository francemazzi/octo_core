import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../storage/db.js";
import { MediaStore } from "../storage/media-store.js";
import { HostKeyProvider, InMemoryKeyProvider } from "./key-provider.js";

function store(keys: HostKeyProvider | InMemoryKeyProvider, dir: string) {
  const db = openDatabase(join(dir, "octo.db"));
  return { db, media: new MediaStore(db, dir, keys) };
}

describe("media key", () => {
  it("stays locked until the host hands over one 32-byte key", () => {
    const keys = new HostKeyProvider();
    expect(keys.available).toBe(false);
    expect(() => keys.getDataKey()).toThrow(
      expect.objectContaining({ code: "keystore_unavailable" }),
    );
    expect(() => keys.unlock(randomBytes(16))).toThrow(
      expect.objectContaining({ code: "invalid_key_material" }),
    );
    const key = randomBytes(32);
    keys.unlock(key);
    keys.unlock(Buffer.from(key));
    expect(keys.available).toBe(true);
    expect(() => keys.unlock(randomBytes(32))).toThrow(
      expect.objectContaining({ code: "key_already_set" }),
    );
  });

  it("tells a screenshot of another key apart from a tampered one", () => {
    const dir = mkdtempSync(join(tmpdir(), "octo-key-"));
    const key = randomBytes(32);
    const first = store(new InMemoryKeyProvider(key), dir);
    const { assetId } = first.media.begin("s1", Buffer.from("Ordine 1001"));
    first.media.commit(assetId);
    first.db.close();

    const again = store(new InMemoryKeyProvider(Buffer.from(key)), dir);
    expect(again.media.readPlaintext(assetId).toString("utf8")).toBe("Ordine 1001");
    again.db.close();

    const other = store(new InMemoryKeyProvider(randomBytes(32)), dir);
    expect(() => other.media.readPlaintext(assetId)).toThrow(
      expect.objectContaining({ code: "media_key_mismatch" }),
    );
    const row = other.db.prepare("SELECT path FROM assets WHERE id = ?").get(assetId) as {
      path: string;
    };
    const envelope = JSON.parse(readFileSync(row.path, "utf8")) as { data: string };
    writeFileSync(
      row.path,
      JSON.stringify({ ...envelope, data: Buffer.from("x").toString("base64") }),
    );
    other.db.close();
    const tampered = store(new InMemoryKeyProvider(Buffer.from(key)), dir);
    expect(() => tampered.media.readPlaintext(assetId)).toThrow(
      expect.objectContaining({ code: "tampered_ciphertext" }),
    );
  });
});
