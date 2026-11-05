import type {
  AssistantExecution,
  AssistantProfile,
} from "../../../src/shared/model/host-contracts/assistant";
import { workerContextSettings } from "../../../src/shared/model/assistantContext";
import { modelContextWindow } from "../../../src/features/sessions/model/models";

/** Provider-local maintenance only; canonical worker admission retains finer thresholds. */
export function assistantWorkerModelSettings(
  profile: AssistantProfile,
  execution: AssistantExecution,
) {
  const settings = { ...execution.modelSettings };
  if (execution.harness !== "claude") return settings;
  const policy = workerContextSettings(profile);
  const explicitWindow = ({ "200k": 200000, "1m": 1000000 } as Record<string, number>)[
    settings.context
  ];
  const window = explicitWindow ?? modelContextWindow(execution.model);
  const threshold = Math.min(
    policy.workerSoftContext,
    window ? Math.floor((window * policy.workerCompactPercent) / 100) : Infinity,
  );
  // Claude accepts this setting only in [100k,1m]. Never pretend a clamped value
  // implements a smaller saved owner threshold; managed-session guards still do.
  delete settings.autoCompactWindow;
  settings.autoCompact = "on";
  if (threshold >= 100000 && threshold <= 1000000) settings.autoCompactWindow = String(threshold);
  return settings;
}
