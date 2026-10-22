import { useEffect, useState } from "react";
import { OPEN_SESSION_IMPORT_EVENT, SESSION_HISTORY_IMPORTED_EVENT, type SessionImportContext } from "../import/importModel";
import { SessionImportDialog } from "./SessionImportDialog";

/**
 * Owns the import dialog so the rail menu and Settings can open it with an
 * event, without the app shell carrying any of its state.
 */
export function SessionImportHost({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<SessionImportContext | undefined>();
  useEffect(() => {
    window.addEventListener(SESSION_HISTORY_IMPORTED_EVENT, onImported);
    return () => window.removeEventListener(SESSION_HISTORY_IMPORTED_EVENT, onImported);
  }, [onImported]);
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<SessionImportContext>).detail;
      setContext(
        detail?.cwd && (detail.provider === "claude" || detail.provider === "codex")
          ? detail
          : undefined,
      );
      setOpen(true);
    };
    window.addEventListener(OPEN_SESSION_IMPORT_EVENT, show);
    return () => window.removeEventListener(OPEN_SESSION_IMPORT_EVENT, show);
  }, []);
  return open ? (
    <SessionImportDialog
      key={context ? `${context.provider}:${context.cwd}` : "all"}
      initialContext={context}
      onClose={() => setOpen(false)}
      onImported={onImported}
    />
  ) : null;
}
