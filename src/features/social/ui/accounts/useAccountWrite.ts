import { useState } from "react";
import { useSocialPending } from "../../hooks/useSocialPending";

/**
 * One write at a time for a settings card: which action is pending, and the plain error of the
 * last failed write. The Host's own message is shown when it gave one; otherwise `failure`.
 */
export function useAccountWrite(failure: string) {
  const pending = useSocialPending();
  const [error, setError] = useState("");
  const write = async <T>(key: string, work: () => Promise<T>): Promise<T | undefined> => {
    setError("");
    try {
      return await pending.run(key, work);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : failure);
      return undefined;
    }
  };
  return { error, setError, is: pending.is, write };
}
