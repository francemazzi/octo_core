import type { OctoBridge } from "../shared/ui-state.js";

declare global {
  interface Window {
    octo: OctoBridge;
  }
}

export {};
