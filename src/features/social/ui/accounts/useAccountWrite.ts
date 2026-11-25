import { presentRemoteError } from "../../../connections/public/remoteFailure";
import { useState } from "react";
import { useSocialPending } from "../../hooks/useSocialPending";

/**
 * One write at a time for a settings card: which action is pending and the last failed write.
 * `error` is the translated `failure` title (empty when nothing failed, or when the machine
 * connection failure is already shown centrally); `details` is the Host's own text when it gave
 * one. Render both: `<InlineError details={details}>{error}</InlineError>`. `setError` replaces
 * the title with a caller-owned sentence and drops the details.
 */
export function useAccountWrite(failure: string) {
  const pending = useSocialPending();
  const [state, setState] = useState<{ error: string; details?: string }>({
    error: "",
  });
  const setError = (error: string) => setState({ error });
  const write = async <T>(key: string, work: () => Promise<T>): Promise<T | undefined> => {
    setState({ error: "" });
    try {
      return await pending.run(key, work);
    } catch (cause) {
      const raw =
        cause instanceof Error && cause.message
          ? presentRemoteError(cause, { explicit: true })
          : undefined;
      setState({ error: raw === "" ? "" : failure, details: raw || undefined });
      return undefined;
    }
  };
  return {
    error: state.error,
    details: state.details,
    setError,
    is: pending.is,
    write,
  };
}
