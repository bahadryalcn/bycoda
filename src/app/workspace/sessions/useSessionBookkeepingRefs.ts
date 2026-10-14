import { useRef, type MutableRefObject } from "react";
import { createEditedResendCoordinator } from "../../../features/sessions/model/editLastTurn";
import type { Session } from "../../../features/sessions/model/session";

export interface SessionBookkeepingRefs {
  editedResends: ReturnType<typeof createEditedResendCoordinator>;
  inFlightSyncKey: MutableRefObject<string | null>;
  sawInFlight: MutableRefObject<boolean>;
  workspaceSyncKey: MutableRefObject<string | null>;
  removingSessionIds: MutableRefObject<Set<string>>;
  loadedSessionCache: MutableRefObject<Map<string, Session>>;
  sessionLoads: MutableRefObject<Map<string, Promise<Session | null>>>;
  sessionLoadEpochs: MutableRefObject<Map<string, number>>;
  openingSessionIds: MutableRefObject<Set<string>>;
  activeSessionPrefetch: MutableRefObject<Promise<Session | null> | null>;
}

/**
 * Session bookkeeping refs (edited-resend coordinator, in-flight and workspace
 * snapshot sync keys, session loads). Refs only, no effects; the same objects
 * as the former Workspace declarations.
 */
export function useSessionBookkeepingRefs(): SessionBookkeepingRefs {
  const editedResends = useRef(createEditedResendCoordinator()).current;
  const inFlightSyncKey = useRef<string | null>(null);
  const sawInFlight = useRef(false);
  const workspaceSyncKey = useRef<string | null>(null);
  const removingSessionIds = useRef(new Set<string>());
  const loadedSessionCache = useRef(new Map<string, Session>());
  const sessionLoads = useRef(new Map<string, Promise<Session | null>>());
  const sessionLoadEpochs = useRef(new Map<string, number>());
  const openingSessionIds = useRef(new Set<string>());
  const activeSessionPrefetch = useRef<Promise<Session | null> | null>(null);
  return {
    editedResends,
    inFlightSyncKey,
    sawInFlight,
    workspaceSyncKey,
    removingSessionIds,
    loadedSessionCache,
    sessionLoads,
    sessionLoadEpochs,
    openingSessionIds,
    activeSessionPrefetch,
  };
}
