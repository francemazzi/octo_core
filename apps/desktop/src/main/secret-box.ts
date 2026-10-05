import { safeStorage } from "electron";
import type { SecretBox } from "./settings-store.js";

const NO_KEYSTORE =
  "Questo computer non offre un archivio sicuro per la chiave: Octo non la salva in chiaro.";

/**
 * The keystore of the operating system (Keychain, DPAPI, libsecret). On Linux without a
 * keyring Electron falls back to a fixed password (`basic_text`): that is not safe enough.
 * Call only once the app is ready.
 */
export function keystoreBox(): SecretBox {
  return {
    problem() {
      if (!safeStorage.isEncryptionAvailable()) return NO_KEYSTORE;
      if (
        process.platform === "linux" &&
        safeStorage.getSelectedStorageBackend() === "basic_text"
      ) {
        return NO_KEYSTORE;
      }
      return null;
    },
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (data) => safeStorage.decryptString(data),
  };
}
