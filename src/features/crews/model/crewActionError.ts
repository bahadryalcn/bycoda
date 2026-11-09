import { t } from "../../../shared/i18n";
import { classifyRemoteError, isConnectionFailure } from "../../connections/public/remoteFailure";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections/public/protocol";

/** A failed crew action, with the machine and operation it belongs to. */
export type CrewActionError = {
  message: string;
  /** When it failed; a later successful read of the same machine retires a connection failure. */
  at: number;
  /** The machine could not be asked at all, as opposed to refusing this one action. */
  connection: boolean;
};

export function crewMachineLabel(machine: RemoteMachine): string {
  return isLocalSyncMachine(machine) ? t("This computer") : machine.name;
}

export function crewActionError(
  reason: unknown,
  operation: string,
  machine: RemoteMachine | undefined,
  at: number,
): CrewActionError {
  const failure = classifyRemoteError(reason);
  const connection = isConnectionFailure(failure) && failure.kind === "unreachable";
  // Native messages name the SSH tunnel; this computer's host has none.
  const detail =
    connection && machine && isLocalSyncMachine(machine)
      ? t(
          "bycoda Host on this computer did not answer. It may be restarting; try again in a moment.",
        )
      : failure.message;
  return {
    message: machine
      ? t("{p0} failed on {p1}: {p2}", {
          p0: operation,
          p1: crewMachineLabel(machine),
          p2: detail,
        })
      : t("{p0} failed: {p1}", { p0: operation, p1: detail }),
    at,
    connection,
  };
}

/** A connection failure is stale once the same machine has answered a read since. */
export function crewActionErrorRecovered(
  error: CrewActionError | undefined,
  dataUpdatedAt: number,
): boolean {
  return !!error?.connection && dataUpdatedAt > error.at;
}
