import { remoteMachineFor, remoteSessionFor, sessionAccessForMachine } from "./connections";
import { parseRemotePath } from "./remoteProjects";

/** Finished working time of a session that lives on another machine's Host. */
export async function loadRemoteWorkedMs(cwd: string, sessionId: string): Promise<number> {
  const remote = parseRemotePath(cwd);
  if (!remote) throw new Error("Not a remote session");
  const machine = await remoteMachineFor(remote.environmentId);
  if (!machine) throw new Error("This project is no longer available.");
  const { workedMs } = await sessionAccessForMachine(
    machine.id,
    false,
    false,
    remote.environmentId,
  ).workedTime(remoteSessionFor(sessionId) ?? sessionId);
  return workedMs;
}
