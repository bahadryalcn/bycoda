// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it } from "vitest";
import { saveLastModelSettings, type AgentModel } from "../../sessions/model/models";
import { saveGlobalSessionDefaults } from "../../sessions/model/providerSessionDefaults";
import { setProjectSessionDefaults } from "../../sessions/model/projectProviders";
import { setHarnessModeLimits } from "../../sessions/model/session";
import { quickSessionModelSettings, quickSessionRuntimeMode } from "./quickSessionDefaults";

const model: AgentModel = {
  id: "codex:fixture",
  harness: "codex",
  name: "Fixture",
  settings: [
    {
      id: "fast",
      label: "Fast",
      kind: "select",
      value: "false",
      options: [
        { value: "false", label: "Off" },
        { value: "true", label: "On" },
      ],
    },
  ],
};
beforeEach(() => localStorage.clear());
afterEach(() => setHarnessModeLimits("codex", undefined));
it("uses provider defaults ahead of recent values while keeping explicit quick edits", () => {
  saveLastModelSettings({ fast: "false" });
  saveGlobalSessionDefaults("codex", { extras: { fast: "true" } });
  expect(quickSessionModelSettings(model, "/repo").fast).toBe("true");
  expect(quickSessionModelSettings(model, "/repo", { fast: "false" }).fast).toBe("false");
  setProjectSessionDefaults("/repo", "codex", { extras: { fast: "false" } });
  expect(quickSessionModelSettings(model, "/repo").fast).toBe("false");
  expect(quickSessionModelSettings(model, "/other").fast).toBe("true");
});
it("uses scoped permissions until explicitly changed and respects runtime limits", () => {
  saveGlobalSessionDefaults("codex", { runtimeMode: "full-access" });
  expect(quickSessionRuntimeMode("codex", "/repo", null)).toBe("full-access");
  setProjectSessionDefaults("/repo", "codex", { runtimeMode: "auto-accept-edits" });
  expect(quickSessionRuntimeMode("codex", "/repo", null)).toBe("auto-accept-edits");
  expect(quickSessionRuntimeMode("codex", "/repo", "supervised")).toBe("supervised");
  setHarnessModeLimits("codex", {
    runtimeModes: { "full-access": "Unsupported" },
    newSessionMode: "supervised",
  });
  expect(quickSessionRuntimeMode("codex", "/other", null)).toBe("supervised");
});
