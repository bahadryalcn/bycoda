import { expect, it, vi } from "vitest";
import { handleVoiceRpc } from "./rpc-voice";

const status = vi.fn(async () => ({ openrouter: true }));
const dependencies = {
  voiceSetup: { models: { status: () => ({ state: "ready" }) } },
  voiceCloud: { status, setKey: vi.fn(), get: vi.fn() },
  localVoice: {},
  engine: {},
} as unknown as Parameters<typeof handleVoiceRpc>[0];
const call = (
  method: string,
  options: { origin?: string; address?: string; owner?: boolean },
): Parameters<typeof handleVoiceRpc>[1] =>
  ({
    input: { method },
    params: {},
    result: undefined,
    domainContext: { authorized: async () => options.owner === true },
    request: {
      headers: options.origin ? { origin: options.origin } : {},
      socket: { remoteAddress: options.address ?? "100.64.0.9" },
    },
  }) as unknown as Parameters<typeof handleVoiceRpc>[1];

it("serves cloud status to a paired owner device but refuses guests and browser origins", async () => {
  const owner = call("voice.cloud.status", { owner: true });
  await handleVoiceRpc(dependencies, owner);
  expect(owner.result).toEqual({ openrouter: true });
  await expect(
    handleVoiceRpc(dependencies, call("voice.cloud.status", { owner: false })),
  ).rejects.toThrow("only on this computer");
  await expect(
    handleVoiceRpc(dependencies, call("voice.cloud.status", { owner: true, origin: "https://x" })),
  ).rejects.toThrow("only on this computer");
});

it("keeps cloud credentials and setup methods local even for an owner device", async () => {
  for (const method of ["voice.cloud.setKey", "voice.cloud.models", "voice.dictation.process"])
    await expect(handleVoiceRpc(dependencies, call(method, { owner: true }))).rejects.toThrow(
      "only on this computer",
    );
  const local = call("voice.cloud.status", { address: "127.0.0.1" });
  await handleVoiceRpc(dependencies, local);
  expect(local.result).toEqual({ openrouter: true });
});

it("gates cloud transcription by the same rule", async () => {
  await expect(
    handleVoiceRpc(dependencies, call("voice.cloud.transcribe", { owner: false })),
  ).rejects.toThrow("only on this computer");
  await expect(
    handleVoiceRpc(
      dependencies,
      call("voice.cloud.transcribe", { owner: true, origin: "https://x" }),
    ),
  ).rejects.toThrow("only on this computer");
  // An owner device passes the gate; the failure now comes from the missing audio.
  await expect(
    handleVoiceRpc(dependencies, call("voice.cloud.transcribe", { owner: true })),
  ).rejects.not.toThrow("only on this computer");
});

it("lets a paired owner device manage local voice models but not a guest or a browser", async () => {
  await expect(
    handleVoiceRpc(dependencies, call("voice.local.modelStatus", { owner: false })),
  ).rejects.toThrow("only on this computer");
  await expect(
    handleVoiceRpc(
      dependencies,
      call("voice.local.modelStatus", { owner: true, origin: "https://x" }),
    ),
  ).rejects.toThrow("only on this computer");
  const owner = call("voice.local.modelStatus", { owner: true });
  await handleVoiceRpc(dependencies, owner);
  expect(owner.result).toBeDefined();
});
