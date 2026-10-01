import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OctoError } from "@octo/engine";
import { startDemo, tempEngine } from "../helpers/engine.js";

describe("A09 docx export", () => {
  it("writes one snapshot to json, folders, and docx, and rejects traversal", async () => {
    const { dir, engine } = tempEngine();
    startDemo(engine);
    engine.replayCapture();
    await engine.runAnalysis("local_only");
    engine.setObjective("episode-A", `<script>alert("x")</script>`);
    const destination = join(dir, "sessione-001");
    mkdirSync(destination, { recursive: true });
    const first = await engine.exportSession(destination, "draft");
    const second = await engine.exportSession(destination, "draft");
    expect(second.version).toBe(first.version + 1);

    const snapshot = JSON.parse(
      readFileSync(join(destination, "report", "riepilogo-sessione.json"), "utf8"),
    ) as {
      missingClips: boolean;
      episodes: Array<{ id: string }>;
    };
    expect(snapshot.missingClips).toBe(true);
    expect(snapshot.episodes.some((episode) => episode.id === "episode-A")).toBe(true);
    const activity = readFileSync(
      join(destination, "attivita", "order_entry", "episode-A", "activity.json"),
      "utf8",
    );
    expect(activity).toContain("episode-A");
    const index = readFileSync(join(destination, "indice.html"), "utf8");
    expect(index).toContain("&lt;script&gt;");
    expect(index).not.toContain("<script>");
    expect(
      readFileSync(join(destination, "da-verificare", "tratto-non-classificato.txt"), "utf8"),
    ).toContain("senza classificazione");

    const xml = execFileSync(
      "unzip",
      ["-p", join(destination, "report", "riepilogo-sessione.docx"), "word/document.xml"],
      {
        encoding: "utf8",
      },
    );
    expect(xml).toContain("Clip: non disponibili");
    expect(xml).toContain("episode-A");
    expect(xml).toContain("bozza");

    engine.db
      .prepare("UPDATE episodes SET activity_type = ? WHERE id = ?")
      .run("../evil", "episode-B");
    await expect(engine.exportSession(join(dir, "bad"), "draft")).rejects.toThrow(OctoError);
    engine.close();
  });
});
