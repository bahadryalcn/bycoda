import { useState, useSyncExternalStore } from "react";
import type { VoiceWorkEntry, VoiceWorkLedger } from "../../model/voiceWorkLedger";

/** The ledger's entries, re-rendering only when the ledger changes. */
export function useVoiceWorkEntries(ledger: VoiceWorkLedger): readonly VoiceWorkEntry[] {
  // Bound once per ledger so the store is not resubscribed on every render.
  const [store] = useState(() => ({
    subscribe: (listener: () => void) => ledger.subscribe(listener),
    entries: () => ledger.entries(),
  }));
  return useSyncExternalStore(store.subscribe, store.entries, store.entries);
}
