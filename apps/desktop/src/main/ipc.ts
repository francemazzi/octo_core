import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { OCTO_CHANNELS, type OctoChannel } from "../shared/ui-state.js";

export type IpcHandler = (payload: unknown, event: IpcMainInvokeEvent) => unknown;

/** Every channel needs a handler; a channel that is not in the table cannot be invoked. */
export function registerIpc(handlers: Record<OctoChannel, IpcHandler>): void {
  for (const channel of OCTO_CHANNELS) {
    ipcMain.handle(channel, (event, payload: unknown) => handlers[channel](payload, event));
  }
}
