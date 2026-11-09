import { expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn(async () => ({ lease: "local" })));
vi.mock("../../connections/model/hostFeatureClient", () => ({ hostToolRequest: request }));
import { localVoiceBackend } from "./localVoiceClient";
it("keeps microphone processing on the local machine instead of following remote project navigation", async () => {
  await localVoiceBackend.start();
  expect(request).toHaveBeenCalledWith(
    "",
    "voice.local.v1",
    "voice.local.start",
    {},
    { kind: "local" },
  );
  await localVoiceBackend.start({ natural: true }, true);
  expect(request).toHaveBeenLastCalledWith(
    "",
    "voice.local.v1",
    "voice.local.start",
    { config: { natural: true }, recognitionOnly: true },
    { kind: "local" },
  );
});

it("requires setup support and targets only this computer for install and progress", async () => {
  await localVoiceBackend.setup({ natural: false });
  await localVoiceBackend.setupStatus();
  expect(request).toHaveBeenCalledWith(
    "",
    "voice.local.setup.v1",
    "voice.local.setup",
    { config: { natural: false } },
    { kind: "local" },
  );
  expect(request).toHaveBeenCalledWith(
    "",
    "voice.local.setup.v1",
    "voice.local.setupStatus",
    {},
    { kind: "local" },
  );
});

it("keeps cloud voice keys on this computer's Host and only reads their status", async () => {
  await localVoiceBackend.cloudStatus();
  expect(request).toHaveBeenLastCalledWith(
    "",
    "voice.cloud.v1",
    "voice.cloud.status",
    {},
    { kind: "local" },
  );
  await localVoiceBackend.setCloudKey("elevenlabs", null);
  expect(request).toHaveBeenLastCalledWith(
    "",
    "voice.cloud.v1",
    "voice.cloud.setKey",
    { provider: "elevenlabs", key: null },
    { kind: "local" },
  );
});
