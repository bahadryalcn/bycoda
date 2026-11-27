import { expect, it, vi } from "vitest";
import { handleVoiceRpc } from "./rpc-voice";
vi.mock("../voice/voice", async (original) => ({
  ...(await original<typeof import("../voice/voice")>()),
  realtimeCredential: async (provider: string) => credentials[provider]?.(),
}));
const credentials: Record<string, (() => string | undefined) | undefined> = {
  openai: () => "test-private-credential",
};
const signIn = { openai: "ready", xai: "missing" };
vi.mock("../voice/voice-transcription-catalog", () => ({
  openRouterTranscriptionModels: async () => [{ id: "test/model", label: "Test model" }],
}));
// The Codex utility turn itself is covered by voice-dictation-process.test.ts.
vi.mock("../voice/voice-dictation-process", () => ({
  processVoiceTranscript: async (input: { text: string }) => ({ text: `Cleaned: ${input.text}` }),
}));

const status = vi.fn(async () => ({ openrouter: true }));
const dependencies = {
  voiceSetup: { models: { status: () => ({ state: "ready" }) } },
  voiceCloud: { status, setKey: vi.fn(), get: vi.fn() },
  localVoice: {},
  engine: {},
} as unknown as Parameters<typeof handleVoiceRpc>[0];
const call = (
  method: string,
  options: { origin?: string; thisComputer?: boolean; owner?: boolean },
): Parameters<typeof handleVoiceRpc>[1] =>
  ({
    input: { method },
    params: {},
    result: undefined,
    domainContext: { authorized: async () => options.owner === true },
    request: {
      headers: options.origin ? { origin: options.origin } : {},
      // Forwarded phone and tunnel requests arrive from loopback; the address grants nothing.
      socket: { remoteAddress: "127.0.0.1" },
    },
    thisComputer: options.thisComputer === true && !options.origin,
  }) as unknown as Parameters<typeof handleVoiceRpc>[1];

it("serves cloud status to a paired owner device but refuses guests and browser origins", async () => {
  const owner = call("voice.cloud.status", { owner: true });
  await handleVoiceRpc(dependencies, owner);
  expect(owner.result).toEqual({ openrouter: true, openai: true, xai: false, signIn });
  await expect(
    handleVoiceRpc(dependencies, call("voice.cloud.status", { owner: false })),
  ).rejects.toThrow("only on this computer");
  await expect(
    handleVoiceRpc(dependencies, call("voice.cloud.status", { owner: true, origin: "https://x" })),
  ).rejects.toThrow("only on this computer");
});

it("tells a phone an expired Grok Build sign-in apart from a missing one, without the credential", async () => {
  const { RealtimeSignInExpiredError } = await import("../voice/voice");
  credentials.xai = () => {
    throw new RealtimeSignInExpiredError("Open Grok Build once to refresh its sign-in.");
  };
  credentials.openai = () => undefined;
  try {
    const owner = call("voice.cloud.status", { owner: true });
    await handleVoiceRpc(dependencies, owner);
    expect(owner.result).toEqual({
      openrouter: true,
      openai: false,
      xai: false,
      signIn: { openai: "missing", xai: "expired" },
    });
    credentials.xai = () => "test-private-credential";
    const ready = call("voice.cloud.status", { owner: true });
    await handleVoiceRpc(dependencies, ready);
    expect(ready.result).toMatchObject({ xai: true, signIn: { xai: "ready" } });
    expect(JSON.stringify(ready.result)).not.toContain("test-private-credential");
  } finally {
    credentials.openai = () => "test-private-credential";
    credentials.xai = undefined;
  }
});

it("keeps cloud credentials and setup methods local even for an owner device", async () => {
  for (const method of ["voice.cloud.setKey", "voice.realtime.secret"])
    await expect(handleVoiceRpc(dependencies, call(method, { owner: true }))).rejects.toThrow(
      "only on this computer",
    );
  const local = call("voice.cloud.status", { thisComputer: true });
  await handleVoiceRpc(dependencies, local);
  expect(local.result).toEqual({ openrouter: true, openai: true, xai: false, signIn });
});

it("runs the opt-in dictation cleanup for the paired owner device, cancellable by its own token only", async () => {
  const runId = "4f6b1c2e-8a3d-4e5f-9a1b-2c3d4e5f6a7b";
  const run = (method: string, tokenHash: string, params: Record<string, unknown>, options = { owner: true } as { owner: boolean; origin?: string }) =>
    ({ ...call(method, options), tokenHash, params }) as Parameters<typeof handleVoiceRpc>[1];
  const phone = run("voice.dictation.process", "phone-token", { runId, text: "merhaba dunya" });
  await handleVoiceRpc(dependencies, phone);
  expect(phone.result).toEqual({ text: "Cleaned: merhaba dunya" });
  for (const refused of [
    run("voice.dictation.process", "guest-token", { runId, text: "a" }, { owner: false }),
    run("voice.dictation.cancel", "phone-token", { runId }, { owner: true, origin: "https://x" }),
  ])
    await expect(handleVoiceRpc(dependencies, refused)).rejects.toThrow("only on this computer");
  const cancel = run("voice.dictation.cancel", "phone-token", { runId });
  await handleVoiceRpc(dependencies, cancel);
  expect(cancel.result).toEqual({ cancelled: true });
  // The device's cancelled run stays refused, while another token's run with the same id is unaffected.
  await expect(
    handleVoiceRpc(dependencies, run("voice.dictation.process", "phone-token", { runId, text: "b" })),
  ).rejects.toThrow("cancelled");
  const desktop = run("voice.dictation.process", "desktop-token", { runId, text: "c" });
  await handleVoiceRpc(dependencies, desktop);
  expect(desktop.result).toEqual({ text: "Cleaned: c" });
});

it("serves public transcription models to the paired owner without exposing credentials", async () => {
  const method = "voice.cloud.models";
  const owner = call(method, { owner: true });
  await handleVoiceRpc(dependencies, owner);
  expect(owner.result).toEqual([{ id: "test/model", label: "Test model" }]);
  await expect(
    handleVoiceRpc(dependencies, call(method, { owner: true, origin: "https://x" })),
  ).rejects.toThrow("only on this computer");
  await expect(handleVoiceRpc(dependencies, call(method, { owner: false }))).rejects.toThrow(
    "only on this computer",
  );
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
