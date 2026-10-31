import { isTauri } from "@tauri-apps/api/core";
import { hasHeadlessChildBackend } from "../../../../integrations/harness/core/child";
import { isRemoteProjectPath } from "../../../../features/projects/model/recents";
import { sessionsRef } from "../../../../features/sessions/model/sessionsStore";
import { sameSessionOutputLifetime } from "../../../../features/sessions/data/sessionOutputProjection";
import {
  saveSessionBeforeSend,
  shouldPersistSession,
} from "../../../../features/sessions/data/sessionStore";

export type NativeOutputSessionStart = {
  sessionId: string;
  /** Resolves with the locator after a real local save, or without one when the
   * save could not be confirmed (the turn then continues unbound). */
  ready: Promise<string | undefined>;
};

/** Begins the pre-provider save without waiting for it, so registry preparation
 * overlaps the write. The caller must await `ready` before any provider effect. */
export function startNativeOutputSession(
  sessionId: string,
  isCurrent: () => boolean,
): NativeOutputSessionStart | undefined {
  if (!isCurrent() || !isTauri() || hasHeadlessChildBackend()) return;
  const session = sessionsRef.current.find((entry) => entry.id === sessionId);
  if (!session || isRemoteProjectPath(session.cwd) || !shouldPersistSession(session)) return;
  const ready = (async (): Promise<string | undefined> => {
    // Real session data is saved by its existing owner, before any provider effect.
    // Native independently rechecks the actual Store/row/window at construction.
    let saved = false;
    try {
      saved = await saveSessionBeforeSend(session);
    } catch (error) {
      console.warn("Conversation could not be saved before starting", error);
    }
    if (!isCurrent()) return;
    if (!saved) {
      console.warn("Conversation could not be saved before starting; continuing without it.");
      return;
    }
    const current = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (
      !current ||
      current.cwd !== session.cwd ||
      current.harness !== session.harness ||
      !sameSessionOutputLifetime(session, current)
    ) {
      console.warn("Conversation changed while preparing to start; continuing without it.");
      return;
    }
    return sessionId;
  })();
  // The awaiting caller reports the failure; this only prevents an unhandled
  // rejection when the turn is cancelled before it reaches the provider.
  ready.catch(() => undefined);
  return { sessionId, ready };
}

/** A locator after a real local save, never a Native grant or row constructor. */
export async function prepareNativeOutputSession(
  sessionId: string,
  isCurrent: () => boolean,
): Promise<string | undefined> {
  return startNativeOutputSession(sessionId, isCurrent)?.ready;
}
