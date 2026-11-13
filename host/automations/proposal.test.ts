import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import type { AssistantProfile } from "../../src/shared/model/host-contracts/assistant";
import { createAutomationProposer, parseAutomationProposal } from "./proposal";
import type { AssistantTextRunner } from "../assistant/core/assistant-text";

const draft = {
  name: "Daily review",
  instruction: "Review the project",
  outputTarget: "projectTask",
  schedule: { scheduleKind: "daily", minute: 0, time: "09:00", dayOfWeek: 1 },
  timeZone: "Europe/Istanbul",
};
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-automation-proposal-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const store = new HostStore(join(root, "host.db"));
  cleanup.push(() => store.close());
  const project = await store.addProject(root, "Project");
  const text = vi.fn<AssistantTextRunner>(async () => ({ text: JSON.stringify(draft) }));
  const preview = vi.fn(() => ({ timeZone: draft.timeZone, nextRunAt: 123456 }));
  const ports = { store, text, preview, profile: async () => ({}) as AssistantProfile };
  const input = {
    operationId: "original-operation",
    request: "Every day review this project at 09:00",
    projectId: project.id,
    currentExecution: { harness: "codex" as const, model: "model", modelSettings: {} },
  };
  const context = { authorized: async () => true, principalId: "owner" };
  return { ports, input, context, text, preview };
}
it("rejects unsupported model fields, invalid times, destinations and timezone changes", () => {
  for (const altered of [
    { ...draft, confirmationRequired: false },
    { ...draft, nextRunAt: 123 },
    { ...draft, outputTarget: "email" },
    { ...draft, name: "   " },
    { ...draft, instruction: "\t\n" },
    { ...draft, schedule: { ...draft.schedule, time: "29:75" } },
    { ...draft, timeZone: "UTC" },
  ])
    expect(() => parseAutomationProposal(JSON.stringify(altered), draft.timeZone)).toThrow();
});
it("normalizes human text in the domain without wire-schema transforms", () => {
  expect(
    parseAutomationProposal(
      JSON.stringify({ ...draft, name: "  Daily review  ", instruction: "  Review the project  " }),
      draft.timeZone,
    ),
  ).toMatchObject(draft);
});
it("rejects a blank request before reserving or invoking a helper", async () => {
  const f = await fixture();
  await expect(
    createAutomationProposer(f.ports)({ ...f.input, request: " \t\n" }, f.context),
  ).rejects.toThrow("must not be blank");
  expect(f.text).not.toHaveBeenCalled();
});
it("returns Host arithmetic, always asks, reuses the durable exact proposal without another helper", async () => {
  const f = await fixture();
  const result = await createAutomationProposer(f.ports)(f.input, f.context);
  expect(result).toMatchObject({
    ...draft,
    preview: { nextRunAt: 123456 },
    confirmationRequired: true,
  });
  expect(f.preview).toHaveBeenLastCalledWith(draft.schedule);
  expect(f.text.mock.calls[0]?.[1]).toContain("no markdown or tools");
  expect(await createAutomationProposer(f.ports)(f.input, f.context)).toEqual(result);
  expect(f.text).toHaveBeenCalledTimes(1);
});
it("fences changed input under the same operation identity", async () => {
  const f = await fixture();
  const propose = createAutomationProposer(f.ports);
  await propose(f.input, f.context);
  await expect(propose({ ...f.input, request: "Different request" }, f.context)).rejects.toThrow(
    "original request",
  );
  expect(f.text).toHaveBeenCalledTimes(1);
});
it("never replays an unresolved helper after a lost reply or runtime recreation", async () => {
  const f = await fixture();
  f.text.mockRejectedValueOnce(new Error("Lost helper reply"));
  await expect(createAutomationProposer(f.ports)(f.input, f.context)).rejects.toThrow(
    "Lost helper reply",
  );
  await expect(createAutomationProposer(f.ports)(f.input, f.context)).rejects.toThrow(
    "not replayed",
  );
  expect(f.text).toHaveBeenCalledTimes(1);
});
it("rejects revoked owner authority before helper admission", async () => {
  const f = await fixture();
  await expect(
    createAutomationProposer(f.ports)(f.input, { authorized: async () => false }),
  ).rejects.toThrow();
  expect(f.text).not.toHaveBeenCalled();
});
