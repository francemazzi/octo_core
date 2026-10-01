export { DeterministicMediaEncoder, segmentIsValid } from "./encoder.js";
export { ElectronDesktopCaptureAdapter } from "./electron-adapter.js";
export { maskText, minimizeText } from "./mask.js";
export { SyntheticCaptureAdapter } from "./synthetic.js";
export { NoopAppContextAdapter } from "./types.js";
export type {
  AppContextAdapter,
  CaptureAdapter,
  CaptureFrame,
  CaptureGap,
  DesktopSource,
  DesktopSourcePort,
} from "./types.js";
