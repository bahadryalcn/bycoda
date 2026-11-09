import { useEffect, useRef, useState } from "react";
import { errorText } from "../../../shared/lib/errors";
import { listMessagingAccounts, MESSAGING_ACCOUNTS_CHANGE_EVENT } from "../model/messagingApi";
import type { MessagingAccount } from "../model/messagingTypes";

// Last-known accounts seed the next mount so the Messages tab does not blink in.
let lastAccounts: MessagingAccount[] = [];

export type MessagingAccountsState = {
  accounts: MessagingAccount[];
  /** True once the first read settled (success or failure). */
  loaded: boolean;
  error: string | null;
};

/** Messaging accounts, re-read when Settings adds, edits or removes one. Only the newest read writes. */
export function useMessagingAccounts(enabled = true): MessagingAccountsState {
  const [state, setState] = useState<MessagingAccountsState>(() => ({
    accounts: enabled ? lastAccounts : [],
    loaded: false,
    error: null,
  }));
  const generation = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => {
      const current = ++generation.current;
      Promise.resolve()
        .then(() => listMessagingAccounts())
        .then((accounts) => {
          if (!alive || current !== generation.current) return;
          const list = Array.isArray(accounts) ? accounts : [];
          lastAccounts = list;
          setState({ accounts: list, loaded: true, error: null });
        })
        .catch((error: unknown) => {
          if (!alive || current !== generation.current) return;
          // Keep the last-known accounts; a failed read must not hide their threads.
          setState((previous) => ({ ...previous, loaded: true, error: errorText(error) }));
        });
    };
    load();
    window.addEventListener(MESSAGING_ACCOUNTS_CHANGE_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(MESSAGING_ACCOUNTS_CHANGE_EVENT, load);
    };
  }, [enabled]);

  return enabled ? state : { accounts: [], loaded: true, error: null };
}
