import { describe, expect, it } from "vitest";
import { failureMessage } from "./ipc-error.js";

describe("IPC failure text", () => {
  it("shows the sentence main wrote, without Electron's wrapper", () => {
    const wrapped = new Error(
      "Error invoking remote method 'octo:chatSend': Error: Nessun modello locale: scaricalo da «Prima di registrare».",
    );
    expect(failureMessage(wrapped)).toBe(
      "Nessun modello locale: scaricalo da «Prima di registrare».",
    );
    expect(
      failureMessage(new Error("Error invoking remote method 'octo:pullModel': TypeError: x")),
    ).toBe("x");
  });

  it("keeps plain messages and never shows an empty one", () => {
    expect(failureMessage(new Error("Chiave verificata."))).toBe("Chiave verificata.");
    expect(failureMessage(new Error("Error invoking remote method 'octo:start': Error: "))).toBe(
      "Operazione non riuscita.",
    );
    expect(failureMessage("boom")).toBe("Operazione non riuscita.");
  });
});
