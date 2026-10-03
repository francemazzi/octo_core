import { contextBridge, ipcRenderer } from "electron";

const api = {
  getState: () => ipcRenderer.invoke("octo:getState"),
  start: (sourceIds: string[]) => ipcRenderer.invoke("octo:start", sourceIds),
  pause: () => ipcRenderer.invoke("octo:pause"),
  stop: () => ipcRenderer.invoke("octo:stop"),
  answer: (input: { questionId: string; episodeId: string; text: string }) =>
    ipcRenderer.invoke("octo:answer", input),
  defer: (questionId: string) => ipcRenderer.invoke("octo:defer", questionId),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on("octo:state", listener);
    return () => ipcRenderer.removeListener("octo:state", listener);
  },
};

contextBridge.exposeInMainWorld("octo", api);
