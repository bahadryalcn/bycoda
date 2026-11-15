import { t } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { classifyRemoteError } from "../../connections/public/remoteFailure";

/** Why a machine's skills could not be listed, in words the user can act on. */
export function machineFailure(machine: { name: string; cwd: string }, error: unknown): string {
  const failure = classifyRemoteError(error);
  const outdated = t(
    "{p0}'s {p1} Host needs updating to list skills. Update it in Machines settings.",
    {
      p0: machine.name,
      p1: PRODUCT_IDENTITY.displayName,
    },
  );
  if (failure.kind === "outdated" || /needs updating/i.test(failure.message)) return outdated;
  if (failure.kind === "unreachable") return t("Couldn't reach {p0}.", { p0: machine.name });
  // A current host accepts an empty project; an older one rejects it as a path.
  if (!machine.cwd && /Invalid workspace path|outside this machine/i.test(failure.message))
    return outdated;
  return failure.message;
}
