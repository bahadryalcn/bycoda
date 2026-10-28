import { isTauri } from "@tauri-apps/api/core";
import { hasHeadlessChildBackend } from "../../../../integrations/harness/core/child";
import { isRemoteProjectPath } from "../../../../features/projects/model/recents";
import { sessionsRef } from "../../../../features/sessions/model/sessionsStore";
import { sameSessionOutputLifetime } from "../../../../features/sessions/data/sessionOutputProjection";
import {
  shouldPersistSession,
  upsertSession,
} from "../../../../features/sessions/data/sessionStore";

/** A locator after a real local save, never a Native grant or row constructor. */
export async function prepareNativeOutputSession(
  sessionId: string,
  isCurrent: () => boolean,
): Promise<string | undefined> {
  if (!isCurrent() || !isTauri() || hasHeadlessChildBackend()) return;
  const session = sessionsRef.current.find((entry) => entry.id === sessionId);
  if (!session || isRemoteProjectPath(session.cwd) || !shouldPersistSession(session)) return;
  // Real session data is saved by its existing owner, before any provider effect.
  // Native independently rechecks the actual Store/row/window at construction.
  const ack = await upsertSession(session);
  if (!isCurrent()) return;
  if (!ack || ack.id !== sessionId)
    throw new Error("Conversation could not be saved before starting.");
  const current = sessionsRef.current.find((entry) => entry.id === sessionId);
  if (
    !current ||
    current.cwd !== session.cwd ||
    current.harness !== session.harness ||
    !sameSessionOutputLifetime(session, current)
  )
    throw new Error("Conversation changed while preparing to start. Try again.");
  return sessionId;
}
