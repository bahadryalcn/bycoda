import {
  mergeModelSettings,
  preferredModelSettings,
  type AgentModel,
} from "../../sessions/model/models";
import {
  applySessionDefaults,
  providerSessionDefaults,
} from "../../sessions/model/providerSessionDefaults";
import {
  runtimeModeForNewSession,
  type HarnessId,
  type RuntimeMode,
} from "../../sessions/model/session";

/** Provider/project defaults win over recents; explicit quick-panel edits win last. */
export function quickSessionModelSettings(
  model: AgentModel,
  cwd?: string,
  overrides: Record<string, string> = {},
) {
  const defaults = applySessionDefaults(
    model,
    preferredModelSettings(model),
    providerSessionDefaults(model.harness, cwd),
  );
  return mergeModelSettings(model, { ...defaults, ...overrides });
}

export function quickSessionRuntimeMode(
  harness: HarnessId,
  cwd: string | undefined,
  picked: RuntimeMode | null,
): RuntimeMode {
  return (
    picked ?? runtimeModeForNewSession(harness, providerSessionDefaults(harness, cwd).runtimeMode)
  );
}
