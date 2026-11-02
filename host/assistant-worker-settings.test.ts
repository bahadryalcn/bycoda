import { expect, it } from "vitest";
import { assistantWorkerModelSettings } from "./assistant-worker-settings";
import type {
  AssistantExecution,
  AssistantProfile,
} from "../src/shared/model/host-contracts/assistant";
const execution = {
  harness: "claude",
  model: "claude:worker-test",
  modelSettings: { effort: "high", context: "1m", autoCompact: "off" },
  runtimeMode: "supervised",
  maxRunMinutes: 30,
} as AssistantExecution;
it("enables provider compaction only for assistant-owned Claude worker settings without mutating the profile", () => {
  const profile = { workerSoftContext: 150000, workerCompactPercent: 50 } as AssistantProfile;
  expect(assistantWorkerModelSettings(profile, execution)).toEqual({
    effort: "high",
    context: "1m",
    autoCompact: "on",
    autoCompactWindow: "150000",
  });
  expect(execution.modelSettings.autoCompact).toBe("off");
  const codex = { ...execution, harness: "codex" as const };
  expect(assistantWorkerModelSettings(profile, codex)).toEqual(codex.modelSettings);
});
it("uses the smaller saved model-window percentage and never claims unsupported small provider thresholds", () => {
  expect(
    assistantWorkerModelSettings({} as AssistantProfile, {
      ...execution,
      modelSettings: { context: "200k" },
    }),
  ).toMatchObject({ autoCompactWindow: "100000" });
  const smaller = assistantWorkerModelSettings(
    { workerSoftContext: 20000 } as AssistantProfile,
    execution,
  );
  expect(smaller.autoCompact).toBe("on");
  expect(smaller).not.toHaveProperty("autoCompactWindow");
});
