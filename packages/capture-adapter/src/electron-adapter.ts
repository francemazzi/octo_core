import type { CaptureAdapter, DesktopSource, DesktopSourcePort } from "./types.js";

export class ElectronDesktopCaptureAdapter implements CaptureAdapter {
  readonly name = "electron";

  constructor(private readonly port: DesktopSourcePort) {}

  listSources(): Promise<DesktopSource[]> {
    return this.port.listSources();
  }

  capability(sources: DesktopSource[]): "single_monitor" | "multi_monitor" {
    const monitors = sources.filter((source) => source.kind === "monitor");
    return monitors.length >= 2 ? "multi_monitor" : "single_monitor";
  }
}
