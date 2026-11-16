import { remoteMachineFor, remoteRequest } from "../../connections/public/connections";
import { parseRemotePath, remoteProjectFor } from "../../connections/public/remoteProjects";
import { GitGenerateTextResultSchema } from "../../../shared/model/host-contracts/git";
import type { GitGenerationChoice } from "./gitGenerationChoice";
import type { HarnessId } from "../../sessions/public/session";

/** Cancellation detaches the wait; the Host's bounded provider call settles independently. */
export async function remoteGitTextGeneration(
  cwd: string,
  kind: "commit" | "pr",
  preferred?: HarnessId,
  choice?: GitGenerationChoice,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const path = parseRemotePath(cwd);
  if (!path) throw new Error("Invalid remote repository path");
  const machine = await remoteMachineFor(path.environmentId);
  signal?.throwIfAborted();
  if (!machine) throw new Error("The repository's machine is unavailable");
  const project =
    remoteProjectFor(cwd) ??
    ((await remoteRequest(
      machine.id,
      "projects.open",
      { cwd: path.hostPath },
      false,
      true,
      path.environmentId,
    )) as { id: string });
  signal?.throwIfAborted();
  const run = remoteRequest(
    machine.id,
    "git.generateText",
    {
      projectId: "projectId" in project ? project.projectId : project.id,
      cwd: path.hostPath,
      kind,
      ...(preferred ? { preferred } : {}),
      ...(choice ? { choice } : {}),
    },
    false,
    true,
    path.environmentId,
  ).then((result) => GitGenerateTextResultSchema.parse(result));
  if (!signal) return run;
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("Git generation cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([run, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
