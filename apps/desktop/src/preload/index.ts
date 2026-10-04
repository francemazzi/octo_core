import { contextBridge, ipcRenderer } from "electron";
import type { AnswerInput, OctoBridge, UiState } from "../shared/ui-state.js";

const api: OctoBridge = {
  getState: () => ipcRenderer.invoke("octo:getState"),
  start: (sourceIds: string[]) => ipcRenderer.invoke("octo:start", sourceIds),
  pause: () => ipcRenderer.invoke("octo:pause"),
  resume: () => ipcRenderer.invoke("octo:resume"),
  stop: () => ipcRenderer.invoke("octo:stop"),
  answer: (input: AnswerInput) => ipcRenderer.invoke("octo:answer", input),
  defer: (questionId: string) => ipcRenderer.invoke("octo:defer", questionId),
  analyze: (sessionId: string) => ipcRenderer.invoke("octo:analyze", sessionId),
  sessionDetail: (sessionId: string) => ipcRenderer.invoke("octo:sessionDetail", sessionId),
  openMain: (sessionId: string | null) => ipcRenderer.invoke("octo:openMain", sessionId),
  mascotPointer: (inside: boolean) => ipcRenderer.invoke("octo:mascotPointer", inside),
  onState: (callback: (state: UiState) => void) => {
    const listener = (_event: unknown, state: UiState) => callback(state);
    ipcRenderer.on("octo:state", listener);
    return () => ipcRenderer.removeListener("octo:state", listener);
  },
};

contextBridge.exposeInMainWorld("octo", api);
