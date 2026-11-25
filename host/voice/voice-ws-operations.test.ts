import { describe, expect, it, vi } from "vitest";
import {
  HostDomainAuthorizationError,
  HostDomainOutcomeError,
  type HostDomainContext,
} from "../domains/context";
import { voiceSocketOperations } from "./voice-ws-operations";
import type { LocalVoiceService } from "./voice-local";
import type { VoiceCloudCredentials } from "./voice-cloud-credentials";
import type { VoiceSetupService } from "./voice-setup";

function setup(state: { setup?: string; models?: string } = {}) {
  const localVoice = {
    start: vi.fn(async () => ({ lease: "lease-a" })),
    transcribe: vi.fn(async () => ({ text: "hello" })),
    speak: vi.fn(() => ({ id: "speech-a" })),
    nextSpeech: vi.fn(async () => ({ done: true })),
    keepAlive: vi.fn(() => ({ ready: true })),
    release: vi.fn(() => ({ released: true })),
  };
  const voiceSetup = {
    status: () => ({ state: state.setup ?? "ready" }),
    models: { status: () => ({ state: state.models ?? "idle" }) },
  };
  const operations = voiceSocketOperations({
    localVoice: localVoice as unknown as LocalVoiceService,
    voiceCloud: { get: vi.fn() } as unknown as VoiceCloudCredentials,
    voiceSetup: voiceSetup as unknown as VoiceSetupService,
  });
  return { localVoice, operations };
}
const context = (authorized = true) =>
  ({ authorized: async () => authorized }) as unknown as HostDomainContext;

describe("phone voice call over the native socket", () => {
  it("starts the recognizer and transcribes one utterance for an authorized device", async () => {
    const { localVoice, operations } = setup();
    await expect(
      operations["voice.local.start"](
        { config: { natural: false }, recognitionOnly: true },
        context(),
      ),
    ).resolves.toEqual({ lease: "lease-a" });
    expect(localVoice.start).toHaveBeenCalledWith({ natural: false }, true, { joinLoaded: true });
    await expect(
      operations["voice.local.transcribe"]({ lease: "lease-a", audio: "AAAA" }, context()),
    ).resolves.toEqual({ text: "hello" });
    expect(localVoice.transcribe).toHaveBeenCalledWith("lease-a", "AAAA", undefined, undefined);
  });
  it("refuses a device whose grant was revoked before touching the recognizer", async () => {
    const { localVoice, operations } = setup();
    await expect(operations["voice.local.start"]({}, context(false))).rejects.toBeInstanceOf(
      HostDomainAuthorizationError,
    );
    expect(localVoice.start).not.toHaveBeenCalled();
  });
  it("rejects audio past one socket frame and unknown fields without calling the service", async () => {
    const { localVoice, operations } = setup();
    await expect(
      operations["voice.local.transcribe"](
        { lease: "lease-a", audio: "A".repeat(1_000_004) },
        context(),
      ),
    ).rejects.toThrow();
    await expect(
      operations["voice.local.release"]({ lease: "lease-a", extra: true }, context()),
    ).rejects.toThrow();
    expect(localVoice.transcribe).not.toHaveBeenCalled();
    expect(localVoice.release).not.toHaveBeenCalled();
  });
  it("keeps the computer's reason when voice is busy installing", async () => {
    const { localVoice, operations } = setup({ setup: "installing" });
    const error: unknown = await operations["voice.local.start"]({}, context()).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(HostDomainOutcomeError);
    expect((error as Error).message).toBe("Voice setup is still running.");
    expect(localVoice.start).not.toHaveBeenCalled();
  });
});
