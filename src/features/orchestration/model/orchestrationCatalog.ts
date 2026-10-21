import { HARNESSES } from "../../sessions/model/session";
import { modelsFor } from "../../sessions/model/models";
import {
  isHarnessAvailable,
  probeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import { refreshHarnessCatalogs } from "../../../integrations/harness/core/registry";
import { validateOrchestrationSettings } from "./orchestrationPlan";

/** Discover worker choices only when the user sends an orchestration request. */
export async function discoverOrchestrationSettings() {
  await probeHarnessAvailability();
  const installed = HARNESSES.filter(isHarnessAvailable);
  // Legacy Gemini CLI can open a browser sign-in from discovery; its built-in
  // configured-model entry stays selectable without spawning it.
  await refreshHarnessCatalogs(installed.filter((harness) => harness !== "gemini"));
  return validateOrchestrationSettings({
    maxWorkers: 2,
    choices: installed.filter(isHarnessAvailable).flatMap((harness) =>
      modelsFor(harness).map(({ id, name }) => ({
        harness,
        model: id,
        name,
      })),
    ),
  });
}
