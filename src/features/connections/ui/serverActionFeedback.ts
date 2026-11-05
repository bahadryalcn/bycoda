import type { useCopyFeedback } from "../../../shared/hooks/useCopyFeedback";
import { t } from "../../../shared/i18n";
import type { RemoteMachine } from "../model/protocol";

type CopyAsync = ReturnType<typeof useCopyFeedback>["copyAsync"];

/** Display addresses without URL credentials or query strings. Records stay native-owned. */
export function machineAddress(machine: RemoteMachine) {
  if (machine.ssh) return machine.ssh.target;
  try {
    const url = new URL(machine.endpoint);
    return `${url.protocol}//${url.host}`;
  } catch {
    return t("Address unavailable");
  }
}

export function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export async function copyWithFeedback(copyAsync: CopyAsync, run: () => Promise<unknown>) {
  let failure: unknown;
  const copied = await copyAsync(
    () =>
      run().catch((reason) => {
        failure = reason;
        throw reason;
      }),
    { parallel: true },
  );
  if (!copied) throw failure ?? new Error(t("Could not copy. Try again."));
}
