import { createStore } from "../../../shared/lib/store";
import { recoverRoomPrivacyProjection } from "./roomPrivacyProjection";

// Non-secret operation receipts survive Settings remounts. No passwords or retry closures.
let snapshot: { pending: Record<string, boolean>; failed: Record<string, boolean> } = {
  pending: {},
  failed: {},
};
const listeners = createStore();
export const subscribePrivacySettingsOperations = listeners.subscribe;
export const getPrivacySettingsOperations = () => snapshot;

export function clearPrivacyOptionFailures() {
  snapshot = {
    ...snapshot,
    failed: { ...snapshot.failed, relock: false, idle: false, together: false },
  };
  listeners.notify();
}

export async function runPrivacySettingsOperation(
  id: string,
  write: () => boolean | Promise<boolean>,
  recover = false,
): Promise<void> {
  if (snapshot.pending[id]) return;
  snapshot = { ...snapshot, pending: { ...snapshot.pending, [id]: true } };
  listeners.notify();
  let saved = false;
  try {
    if (recover) await recoverRoomPrivacyProjection();
    saved = await write();
  } catch {
    // Keep the failed receipt for explicit recovery at its initiating control.
  } finally {
    snapshot = {
      pending: { ...snapshot.pending, [id]: false },
      failed: { ...snapshot.failed, [id]: !saved },
    };
    listeners.notify();
  }
}
