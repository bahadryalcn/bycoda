import { withHarnessChoice } from "./handoff";
import { HARNESSES, type HarnessId, type Session } from "./session";

/** Recover a legacy mixed identity without attaching another provider's native
 * thread to the user's explicitly selected model. The ordinary handoff archives
 * the transcript on Send; an invalid outgoing model uses its deterministic recap. */
export function repairSessionModelIdentity(session: Session): Session {
  if (session.busy || session.continuingElsewhere || session.historyLoading) return session;
  const separator = session.model.indexOf(":");
  if (separator < 0) return session;
  const owner = session.model.slice(0, separator) as HarnessId;
  if (!HARNESSES.includes(owner) || owner === session.harness) return session;
  const pendingSwitch =
    session.pendingSwitch && session.pendingSwitch.from !== owner
      ? session.pendingSwitch
      : {
          from: session.harness,
          fromModel: session.model,
          fromSettings: session.modelSettings,
          ...(session.providerSessionId
            ? { fromProviderSessionId: session.providerSessionId }
            : {}),
          ...(session.providerAccountId
            ? { fromProviderAccountId: session.providerAccountId }
            : {}),
        };
  return {
    ...withHarnessChoice(session, owner, session.model, session.modelSettings),
    pendingSwitch,
    context: undefined,
    usageLimit: undefined,
    runningModelTarget: undefined,
  };
}
