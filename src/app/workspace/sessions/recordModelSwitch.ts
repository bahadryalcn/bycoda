import {
  providerAccountLabel,
  sessionProviderAccountId,
  supportsProviderAccounts,
} from "../../../features/providers/model/providerAccounts";
import { resolveModel } from "../../../features/sessions/model/models";
import {
  withModelSwitch,
  type ModelSwitchState,
  type ModelSwitchStep,
} from "../../../features/sessions/model/modelSwitchHistory";
import { HARNESS_TITLE, type Session } from "../../../features/sessions/model/session";
import { setSessions } from "../../../features/sessions/model/sessionsStore";

type SwitchSource = Pick<Session, "harness" | "model" | "providerAccountId" | "providerSessionId">;

/** Provider, account label and model name a session runs under; `accountId` overrides its account. */
export function modelSwitchState(session: SwitchSource, accountId?: string): ModelSwitchState {
  const harness = session.harness;
  return {
    harness,
    ...(supportsProviderAccounts(harness)
      ? {
          account: providerAccountLabel(
            harness,
            accountId ?? sessionProviderAccountId(harness, session),
          ),
        }
      : {}),
    model: resolveModel(harness, session.model).name,
  };
}

/**
 * Writes the switch from `before` to the session's current state into its
 * transcript row. `accountId` names an account picked for the next message.
 */
export function recordModelSwitch(
  sessionId: string,
  before: SwitchSource | undefined,
  options: { note?: ModelSwitchStep["note"]; accountId?: string } = {},
): void {
  if (!before) return;
  const from = modelSwitchState(before);
  setSessions((prev) => {
    const index = prev.findIndex((session) => session.id === sessionId);
    if (index < 0) return prev;
    const to = { ...modelSwitchState(prev[index], options.accountId), note: options.note };
    const next = withModelSwitch(prev[index], from, to, switchText(to));
    if (next === prev[index]) return prev;
    const sessions = prev.slice();
    sessions[index] = next;
    return sessions;
  });
}

function switchText(state: ModelSwitchState & Pick<ModelSwitchStep, "note">): string {
  const target = [HARNESS_TITLE[state.harness], state.account, state.model]
    .filter(Boolean)
    .join(" · ");
  if (state.note === "deferred") return `The next message will use ${target}.`;
  if (state.note === "summary") {
    return `Continuing with ${target}. The conversation could not be moved over, so a summary goes with your next message.`;
  }
  return `Continuing with ${target}`;
}
