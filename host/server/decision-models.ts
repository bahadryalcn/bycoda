import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessId } from "../../src/features/sessions/model/session";
import { registerBuiltinHarnesses } from "../../src/integrations/harness/core/register";
import { runHarnessTextPrompt } from "../../src/integrations/harness/core/registry";
import { DecisionModelsService } from "../decision-models/decision-service";
import type { AdapterTransport } from "../decision-models/contract-adapters/common";
import { osSecretValues } from "../secrets/secret-store";
import type { ServerBindings } from "./bindings";

export function createDecisionModelsRuntime(
  dependencies: Pick<ServerBindings, "featureDirectory" | "engine">,
) {
  const directory = join(dependencies.featureDirectory, "decision-models");
  const decisionModels = new DecisionModelsService({
    directory,
    secrets: osSecretValues(directory, dependencies.engine.store.environmentId),
    runTextPrompt: decisionTextPrompt(directory),
  });
  return { decisionModels };
}

/**
 * Text runner for llm-structured sources: the provider harness the source names, one isolated
 * prompt in an empty workspace. Unknown harness ids are rejected by the harness registry.
 */
function decisionTextPrompt(directory: string): AdapterTransport["runTextPrompt"] {
  return async ({ harness, prompt, model, signal }) => {
    if (!harness) throw new Error("This decision source names no provider.");
    const cwd = join(directory, "text-workspace");
    await mkdir(cwd, { recursive: true, mode: 0o700 });
    registerBuiltinHarnesses();
    return runHarnessTextPrompt({
      harness: harness as HarnessId,
      cwd,
      model,
      prompt,
      intent: "plan",
      ephemeral: true,
      timeoutMs: 90_000,
      signal,
    });
  };
}
