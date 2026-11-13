import { expect, it, vi } from "vitest";
const modelService = vi.hoisted(() => ({
  state: "idle" as "idle" | "working",
  start: vi.fn(),
  list: vi.fn(),
  cancel: vi.fn(),
}));
import { handleVoiceRpc } from "./rpc-voice";

it("prevents model jobs, runtime starts and setup jobs from overlapping", async () => {
  const dependencies = {
    voiceSetup: {
      status: () => ({ state: "idle" }),
      start: vi.fn(),
      models: {
        status: () => ({ state: modelService.state }),
        start: modelService.start,
        list: modelService.list,
        cancel: modelService.cancel,
      },
    },
    localVoice: { isActive: false, close: vi.fn(), start: vi.fn() },
    engine: {},
    voiceCloud: {},
  } as unknown as Parameters<typeof handleVoiceRpc>[0];
  const request = (method: string) =>
    ({
      input: { method },
      params: { id: "small", action: "delete" },
      request: { headers: {}, socket: { remoteAddress: "127.0.0.1" } },
    }) as unknown as Parameters<typeof handleVoiceRpc>[1];
  modelService.state = "working";
  await expect(handleVoiceRpc(dependencies, request("voice.local.start"))).rejects.toThrow(
    "model action is running",
  );
  await expect(handleVoiceRpc(dependencies, request("voice.local.setup"))).rejects.toThrow(
    "model action is running",
  );
  modelService.state = "idle";
  Object.assign(dependencies.localVoice, { isActive: true });
  await expect(handleVoiceRpc(dependencies, request("voice.local.modelAction"))).rejects.toThrow(
    "Disconnect voice",
  );
  Object.assign(dependencies.localVoice, { isActive: false });
  vi.spyOn(dependencies.voiceSetup, "status").mockReturnValue({ state: "installing" });
  await expect(handleVoiceRpc(dependencies, request("voice.local.modelAction"))).rejects.toThrow(
    "setup is still running",
  );
  expect(modelService.start).not.toHaveBeenCalled();
});
