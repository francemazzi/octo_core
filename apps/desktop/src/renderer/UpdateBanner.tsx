import type { UiUpdate } from "../shared/ui-state.js";

/** Shown only when a newer release exists: one button downloads and opens it. */
export function UpdateBanner({ update }: { update: UiUpdate }) {
  if (update.status === "none") return null;
  const downloading = update.status === "downloading";
  const label = downloading
    ? `Download in corso${update.progress === null ? "…" : ` ${update.progress}%`}`
    : update.status === "error"
      ? "Riprova"
      : "Aggiorna";

  return (
    <div className="update-banner" role="status">
      <span>
        {update.status === "ready"
          ? (update.message ?? "Aggiornamento scaricato.")
          : `È disponibile Octo Core ${update.version ?? ""}.${update.message ? ` ${update.message}` : ""}`}
      </span>
      {update.status === "ready" ? null : (
        <button
          type="button"
          disabled={downloading}
          onClick={() => void window.octo.installUpdate()}
        >
          {label}
        </button>
      )}
    </div>
  );
}
