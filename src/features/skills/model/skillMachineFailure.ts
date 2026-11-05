import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { classifyRemoteError } from "../../connections/public/remoteFailure";

/** Why a machine's skills could not be listed, in words the user can act on. */
export function machineFailure(machine: { name: string; cwd: string }, error: unknown): string {
  const failure = classifyRemoteError(error);
  const outdated = `${machine.name}'s ${PRODUCT_IDENTITY.displayName} Host needs updating to list skills. Update it in Connections settings.`;
  if (failure.kind === "outdated" || /needs updating/i.test(failure.message)) return outdated;
  if (failure.kind === "unreachable") return `Couldn't reach ${machine.name}.`;
  // A current host accepts an empty project; an older one rejects it as a path.
  if (!machine.cwd && /Invalid workspace path|outside this machine/i.test(failure.message))
    return outdated;
  return failure.message;
}
