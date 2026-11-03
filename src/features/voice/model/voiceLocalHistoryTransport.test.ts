import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ environmentId: "original", capture: vi.fn(), request: vi.fn() }));
vi.mock("../../assistant/model/assistantHostRead", () => ({
  captureAssistantHostRead: () => {
    state.capture();
    return Promise.resolve({ environmentId: state.environmentId });
  },
}));
vi.mock("../../connections/model/hostFeatureClient", () => ({
  hostToolRequest: (...args: unknown[]) => state.request(...args),
}));
import { captureLocalVoiceHistory } from "./voiceHistoryTransport";
beforeEach(() => {
  vi.clearAllMocks();
  state.environmentId = "original";
  state.request.mockImplementation(async (_path, _cap, _op, _input, _target, expected) => {
    if (expected !== state.environmentId) throw new Error("captured environment changed");
    return { projects: [] };
  });
});
it("freezes actual local environment before lookup and never retargets a later retry to its replacement", async () => {
  const route = captureLocalVoiceHistory();
  expect(state.capture).not.toHaveBeenCalled();
  expect(await route.environmentId!()).toBe("original");
  await route.request({ op: "projects.list" });
  state.environmentId = "replacement";
  await expect(route.request({ op: "projects.list" })).rejects.toThrow("environment changed");
  expect(state.capture).toHaveBeenCalledTimes(1);
  expect(state.request.mock.calls.every((call) => call[5] === "original")).toBe(true);
});
it("captures a fresh environment only for a new explicit binding", async () => {
  const original = captureLocalVoiceHistory();
  await original.environmentId!();
  state.environmentId = "replacement";
  const next = captureLocalVoiceHistory();
  expect(await next.environmentId!()).toBe("replacement");
  expect(await original.environmentId!()).toBe("original");
});
