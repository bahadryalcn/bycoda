import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../../../../shared/lib/errors";
import {
  listMessagingAccounts,
  MESSAGING_ACCOUNTS_CHANGE_EVENT,
  type MessagingAccount,
  type MessagingProvider,
} from "../../../messaging";

/**
 * One provider's saved accounts, refreshed whenever any surface adds, edits or removes one.
 * A failed read keeps the last good list and reports the error; it is never shown as "none".
 */
export function useMessagingAccounts(provider: MessagingProvider) {
  const [accounts, setAccounts] = useState<MessagingAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const all = await listMessagingAccounts();
      if (generation !== request.current) return;
      setAccounts((Array.isArray(all) ? all : []).filter((item) => item.provider === provider));
    } catch (err: unknown) {
      if (generation === request.current) setError(errorText(err));
    } finally {
      if (generation === request.current) setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    const refresh = () => {
      reload().catch(() => undefined);
    };
    refresh();
    window.addEventListener(MESSAGING_ACCOUNTS_CHANGE_EVENT, refresh);
    return () => {
      request.current += 1;
      window.removeEventListener(MESSAGING_ACCOUNTS_CHANGE_EVENT, refresh);
    };
  }, [reload]);

  return { accounts, loading, error, reload };
}
