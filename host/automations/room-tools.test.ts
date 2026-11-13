import { expect, it, vi } from "vitest";
import type { AssistantPorts } from "../assistant/service";
import type { ServerBindings } from "../server/bindings";
import { roomAutomationTools, type RoomAutomationSources } from "./room-tools";

const call = {
  threadId: "room",
  projectId: "selected",
  family: "conversation" as const,
  action: "tasks.list",
  input: {},
  requestId: "request",
};
const sources = (): RoomAutomationSources => ({ deviceHash: "a".repeat(64), calls: [] });

it("validates original native capture before accepting its device route", async () => {
  const relay = vi.fn(async () => ({
    deviceHash: "a".repeat(64),
    relayId: "relay",
    envelope: { signed: true },
  }));
  const validate = vi.fn(async () => {
    throw new Error("Foreign native issuer");
  });
  const bindings = {
    conversationDesktop: { callAssistantThread: relay },
    visibilityAdmission: { withCaptures: validate },
  } as unknown as Pick<ServerBindings, "conversationDesktop" | "visibilityAdmission">;
  const tools = roomAutomationTools({} as AssistantPorts, () => bindings, "environment");
  await expect(tools.capture("room", "occurrence", async () => true)).rejects.toThrow(
    "Foreign native issuer",
  );
  expect(relay).toHaveBeenCalledWith(
    "privacy.account.capture",
    expect.objectContaining({
      requestId: expect.any(String),
      operationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }),
    { threadId: "room", environmentId: "environment" },
    expect.any(Function),
  );
  expect(validate).toHaveBeenCalledTimes(1);
});

it("passes exact original authority and Stop signal to registered dispatcher", async () => {
  const result = {
    value: { rows: [] },
    source: {
      environmentId: "environment",
      threadId: "room",
      family: "conversation" as const,
      action: "tasks.list",
    },
  };
  const dispatch = vi.fn(async () => result);
  const tools = roomAutomationTools(
    { roomManagement: dispatch } as unknown as AssistantPorts,
    () => {
      throw new Error("Capture must not be replaced");
    },
    "environment",
  );
  const controller = new AbortController();
  const authorized = async () => true;
  const original = sources();
  await tools.call(call, original, authorized, controller.signal);
  expect(dispatch).toHaveBeenCalledWith(call, {
    environmentId: "environment",
    deviceHash: original.deviceHash,
    authorized,
    signal: controller.signal,
  });
  expect(original.calls).toEqual([{ call, result }]);
});

it.each([{ state: "unknown" }, { receipt: { status: "uncertain" } }])(
  "does not turn uncertain effects into a successful observation",
  async (value) => {
    const dispatch = vi.fn(async () => ({
      value,
      source: {
        environmentId: "environment",
        threadId: "room",
        family: "conversation" as const,
        action: "tasks.list",
      },
    }));
    const tools = roomAutomationTools(
      { roomManagement: dispatch } as unknown as AssistantPorts,
      () => {
        throw new Error("Unused");
      },
      "environment",
    );
    const original = sources();
    await expect(
      tools.call(call, original, async () => true, new AbortController().signal),
    ).rejects.toThrow("original operation");
    expect(original.calls).toEqual([]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  },
);

it.each([
  "tasks.create",
  "tasks.start",
  "automations.create",
  "automations.runNow",
  "sessions.submit",
  "commands.dispatch",
  "terminals.write",
  "crews.start",
  "social.send.propose",
])("blocks untracked %s effects before original dispatcher can queue them", async (action) => {
  const dispatch = vi.fn();
  const tools = roomAutomationTools(
    { roomManagement: dispatch } as unknown as AssistantPorts,
    () => {
      throw new Error("Unused");
    },
    "environment",
  );
  const original = sources();
  await expect(
    tools.call({ ...call, action }, original, async () => true, new AbortController().signal),
  ).resolves.toMatchObject({ value: { state: "unavailable" } });
  expect(dispatch).not.toHaveBeenCalled();
  expect(original.calls).toEqual([]);
});
