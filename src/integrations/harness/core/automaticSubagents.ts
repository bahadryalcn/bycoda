import { resolveSubagents } from "../../../shared/model/automaticSubagents";
import { AUTOMATIC_SUBAGENTS } from "../../../shared/model/host-contracts/delegation";
import { HARNESSES, type HarnessId } from "../../../shared/model/harnessIdentity";
import { modelsFor, isModelEnabled } from "../../../features/sessions/model/models";
import { isHarnessAvailable } from "./availabilityState";
import { defaultProviderAccountId } from "../../../features/providers/model/providerAccounts";

/** Runtime catalog preview. agents.options remains the live Host authority. */
export function runtimeAutomaticSubagents(thread?: {
  harness?: string;
  providerAccountId?: string;
}) {
  const providers = HARNESSES.filter(isHarnessAvailable);
  return resolveSubagents(AUTOMATIC_SUBAGENTS, {
    harness: (thread?.harness ?? "claude") as HarnessId,
    providerAccountId: thread?.providerAccountId,
    providers,
    models: providers.flatMap((id) => modelsFor(id).filter((model) => isModelEnabled(model.id))),
    defaultAccounts: {
      claude: defaultProviderAccountId("claude"),
      codex: defaultProviderAccountId("codex"),
    },
  });
}
