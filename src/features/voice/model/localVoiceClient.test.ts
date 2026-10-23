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
});
