import { useEffect, type MutableRefObject } from "react";
import { rememberProjectLocation } from "../../../features/projects/model/projectLocation";
import { persistFingerprint } from "../../../features/sessions/data/sessionStore";
import type { Session } from "../../../features/sessions/model/session";
import type { WindowTransferPayload } from "../../model/windowTransfer";
import type { ResumedWorkspace } from "../../model/appLifecycle";
import { lastUserBlockId } from "../helpers/sessionHelpers";

export interface ProjectLocationSeedingDeps {
  recents: ReadonlyArray<{ readonly path: string }>;
  windowTransfer: WindowTransferPayload | null;
  resumed: ResumedWorkspace | null;
  observedSessions: MutableRefObject<Map<string, Session>>;
  lastPersisted: MutableRefObject<Map<string, string>>;
  lastPersistedUserBlock: MutableRefObject<Map<string, string>>;
  lastBoundProvider: MutableRefObject<Map<string, string>>;
  importedSessionsApplied: MutableRefObject<boolean>;
}

/** Remembers every recent project's location, and seeds persistence fingerprints from imported sessions once. */
export function useProjectLocationSeeding({
  recents,
  windowTransfer,
  resumed,
  observedSessions,
  lastPersisted,
  lastPersistedUserBlock,
  lastBoundProvider,
  importedSessionsApplied,
}: ProjectLocationSeedingDeps): void {
  useEffect(() => {
    for (const project of recents) {
      void rememberProjectLocation(project.path).catch((error) => {
        console.warn("App operation failed", error);
      });
    }
  }, [recents]);

  useEffect(() => {
    if (importedSessionsApplied.current) return;
    const imported = windowTransfer?.sessions ?? resumed?.sessions;
    if (!imported?.length) return;
    importedSessionsApplied.current = true;
    for (const session of imported) {
      observedSessions.current.set(session.id, session);
      lastPersisted.current.set(session.id, persistFingerprint(session));
      const userId = lastUserBlockId(session);
      if (userId) lastPersistedUserBlock.current.set(session.id, userId);
      if (session.providerSessionId) {
        lastBoundProvider.current.set(session.id, session.providerSessionId);
      }
    }
  }, [windowTransfer, resumed]);
}
