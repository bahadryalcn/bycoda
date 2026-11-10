import type { AssistantExecution } from "../../../../shared/model/host-contracts/assistant";
import { useModelSource } from "../../../sessions/public/modelSource";
import { defaultModelSettings } from "../../../sessions/public/models";

/**
 * The worker execution the live catalog offers by default, or `null` when no default model is
 * available. Callers turn `null` into "Choose a worker model before enabling job execution."
 * instead of saving an unavailable fallback.
 */
export function useDefaultWorkerExecution() {
  const modelSource = useModelSource();
  return (
    runtimeMode: AssistantExecution["runtimeMode"] = "supervised",
  ): AssistantExecution | null => {
    const resolved = modelSource.resolve("codex", "");
    if (
      resolved.harness !== "codex" ||
      !resolved.id.trim() ||
      !modelSource.available(resolved.harness) ||
      !modelSource
        .modelsFor(resolved.harness)
        .some((model) => model.harness === resolved.harness && model.id === resolved.id)
    )
      return null;
    return {
      harness: resolved.harness,
      model: resolved.id,
      modelSettings: defaultModelSettings(resolved),
      runtimeMode,
      maxRunMinutes: 60,
    };
  };
}
