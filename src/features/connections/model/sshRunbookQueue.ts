import { useSyncExternalStore } from "react";
import {
  pendingSshRunbookIntents,
  listSshRunbooks,
  triggerSshRunbookIntent,
  type SshRunbookIntent,
} from "./sshRunbooks";

// A window-local projection of native automation_runs, never execution authority.
type Snapshot = { intents: SshRunbookIntent[]; error: string };
let snapshot: Snapshot = { intents: [], error: "" };
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();
function publish(next: Snapshot) {
  if (JSON.stringify(snapshot) === JSON.stringify(next)) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}
export function refreshSshRunbookQueue(): Promise<void> {
  if (pending) return pending;
  pending = pendingSshRunbookIntents()
    .then((intents) => {
      if (
        !Array.isArray(intents) ||
        new Set(intents.map((intent) => intent.id)).size !== intents.length ||
        intents.some(
          (intent) =>
            !intent.id ||
            !intent.automationId ||
            !Number.isSafeInteger(intent.revision) ||
            intent.revision < 1 ||
            !["startup", "scheduled"].includes(intent.trigger) ||
            intent.status !== "pendingReview",
        )
      )
        throw new Error("Invalid SSH review queue");
      publish({ intents, error: "" });
    })
    .catch((reason) => {
      publish({ ...snapshot, error: String(reason) });
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}
export function useSshRunbookQueue() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => snapshot,
  );
}

/** Only explicit live terminals call this after the native trusted prompt signal. */
export async function requestSshStartupReviews(serverId: string) {
  try {
    const profiles = await listSshRunbooks();
    for (const profile of profiles) {
      if (profile.triggers?.startupServerIds.includes(serverId)) {
        await triggerSshRunbookIntent(profile.id, profile.revision, serverId);
      }
    }
    await refreshSshRunbookQueue();
  } catch (reason) {
    publish({ ...snapshot, error: String(reason) });
  }
}
