import { useRemoteMachines } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";

/** This computer's Host, which stores session lifecycle and task links. */
export function useLocalLifecycleMachine(): string | undefined {
  const { machines } = useRemoteMachines();
  return machines.find(isLocalSyncMachine)?.id;
}
