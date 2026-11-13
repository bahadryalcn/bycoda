import { beforeEach, expect, it, vi } from "vitest";
import { automationRoutingHost, resolveAutomationLaunch } from "./automationRouting";
import { newAutomationDraft, type Automation, type AutomationRun } from "./automations";
import { EMPTY_MODEL_ROUTING } from "../../../shared/model/host-contracts/model-routing";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  capabilities: vi.fn(),
  resolve: vi.fn(),
  request: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./machineSnapshot", () => ({ machineCapabilities: mocks.capabilities }));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: mocks.request }));
vi.mock("../../connections/model/localSync", () => ({
  isLocalSyncMachine: (machine: { id: string }) => machine.id === "local",
}));
vi.mock("../../model-routing/public/choice", () => ({ resolveModelRouting: mocks.resolve }));
const automation = (): Automation => ({
  ...newAutomationDraft("/repo", "claude", "claude:saved"),
  id: "automation",
  name: "Audit",
  prompt: "Audit",
  modelSettings: { effort: "low" },
  providerAccountId: "saved-account",
  nextRunAt: 1,
  createdAt: 1,
  updatedAt: 1,
});
const run = (): AutomationRun => ({
  id: "run",
  automationId: "automation",
  trigger: "manual",
  status: "pending",
  scheduledFor: 1,
  createdAt: 1,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.invoke.mockResolvedValue([{ id: "remote" }, { id: "local" }]);
  mocks.capabilities.mockResolvedValue(["models.routing.v1"]);
  mocks.resolve.mockResolvedValue({ ok: false, reason: "notConfigured", skipped: [] });
  mocks.request.mockResolvedValue({
    state: { ...EMPTY_MODEL_ROUTING, version: 0, updatedAt: 0, defaultMaxRunMinutes: 17 },
  });
});

it.each(["unreachable", "oldHost", "notConfigured"])(
  "keeps saved model and settings for %s",
  async (scenario) => {
    if (scenario === "unreachable") mocks.resolve.mockRejectedValue(new Error("offline"));
    if (scenario === "oldHost") mocks.capabilities.mockResolvedValue([]);
    const result = await resolveAutomationLaunch(automation(), run());
    expect(result.automation).toMatchObject({
      harness: "claude",
      model: "claude:saved",
      providerAccountId: "saved-account",
      modelSettings: { effort: "low" },
    });
    expect(result.skip).toBeUndefined();
    if (scenario === "oldHost") expect(mocks.resolve).not.toHaveBeenCalled();
    else
      expect(mocks.resolve).toHaveBeenCalledWith(
        "local",
        expect.objectContaining({ role: "automation", choice: { kind: "fixed" } }),
      );
  },
);
it("resolves choice and account through the local Host and inherits its default run limit", async () => {
  const target = {
    harness: "codex",
    providerAccountId: "routed-account",
    model: "codex:routed",
    modelSettings: { effort: "high", crossAdvisor: "advisor" },
  };
  mocks.resolve.mockResolvedValue({
    ok: true,
    target,
    source: { kind: "order", entryId: "entry" },
    skipped: [],
  });
  const result = await resolveAutomationLaunch(
    { ...automation(), modelChoice: { kind: "default" } },
    run(),
  );
  expect(result).toMatchObject({ automation: target, execution: target, maxRunMinutes: 17 });
  expect(mocks.resolve).toHaveBeenCalledWith(
    "local",
    expect.objectContaining({ choice: { kind: "default" } }),
  );
});
it("keeps explicit run limits and the resolved target when the defaults read fails", async () => {
  mocks.resolve.mockResolvedValue({
    ok: true,
    target: { harness: "claude", model: "claude:routed", modelSettings: {} },
    source: { kind: "fixed" },
    skipped: [],
  });
  mocks.request.mockRejectedValue(new Error("offline"));
  expect(await resolveAutomationLaunch(automation(), run())).toMatchObject({
    execution: { model: "claude:routed" },
    maxRunMinutes: 0,
  });
  expect(await resolveAutomationLaunch({ ...automation(), maxRunMinutes: 9 }, run())).toMatchObject(
    { maxRunMinutes: 9 },
  );
});
it("surfaces exhausted routing as a skipped run without silently changing model", async () => {
  mocks.resolve.mockResolvedValue({
    ok: false,
    reason: "noEligibleEntry",
    skipped: [{ entryId: "quota", reason: "belowLimit" }],
    nextResetAt: 100,
  });
  expect(await resolveAutomationLaunch(automation(), run())).toMatchObject({
    skip: expect.stringContaining("quota: belowLimit"),
    execution: undefined,
  });
});
it("never re-resolves a frozen run or a run with a session", async () => {
  const execution = {
    harness: "claude" as const,
    model: "claude:frozen",
    modelSettings: { effort: "high" },
  };
  expect(
    await resolveAutomationLaunch(automation(), { ...run(), execution, maxRunMinutes: 4 }),
  ).toMatchObject({ execution, maxRunMinutes: 4 });
  await resolveAutomationLaunch(automation(), { ...run(), sessionId: "existing" });
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("looks up the background execution Host only when explicitly supplied", async () => {
  expect(await automationRoutingHost("remote")).toEqual({ machineId: "remote", supported: true });
});
