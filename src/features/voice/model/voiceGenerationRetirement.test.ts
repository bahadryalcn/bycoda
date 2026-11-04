import { expect, it, vi } from "vitest";
import {
  registerVoiceGenerationRetirement,
  retireVoiceGeneration,
  recordVoiceGenerationClosure,
  beginVoiceRuntime,
  associateVoiceGeneration,
  bindVoiceGeneration,
  closeVoiceRuntimeEvidence,
  voiceGenerationStatus,
  voiceGenerationSource,
} from "./voiceGenerationRetirement";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: native.invoke }));
const source = { environmentId: "host", threadId: "room" };
const input = (generationKey: string) => ({
  generationKey,
  requestId: "retire",
  operationHash: "a".repeat(64),
});
it("requires a bound live source before output readiness and rejects pending closure", async () => {
  native.invoke.mockImplementation((name: string) => Promise.resolve(name === "voice_runtime_birth" ? "source-birth" : undefined));
  const runtime = {};
  const generation = "preconnect-source";
  registerVoiceGenerationRetirement(generation, () => source, async () => {}, () => false);
  associateVoiceGeneration(runtime, generation);
  expect(() => voiceGenerationSource(input(generation), source)).toThrow("unavailable");
  await beginVoiceRuntime(runtime, "openai");
  await bindVoiceGeneration(generation, source);
  expect(voiceGenerationSource(input(generation), source)).toEqual({ generationKey: generation, active: true });
  expect(() => voiceGenerationSource(input(generation), { ...source, threadId: "other" })).toThrow("unavailable");
  const closure = Promise.withResolvers<void>();
  recordVoiceGenerationClosure(generation, closure.promise);
  expect(() => voiceGenerationSource(input(generation), source)).toThrow("unavailable");
  closure.resolve();
});
it("binds a live narration generation to its Native runtime before any owner utterance", async () => {
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (name: string) => name === "voice_runtime_birth" ? "narration-birth" : undefined);
  const runtime = {};
  const generation = "narration-before-utterance";
  let ready = true;
  const closed = Promise.withResolvers<void>();
  await beginVoiceRuntime(runtime, "openai");
  registerVoiceGenerationRetirement(generation, () => source, async () => { await closed.promise; }, () => ready);
  associateVoiceGeneration(runtime, generation);
  await bindVoiceGeneration(generation, source);
  expect(native.invoke).toHaveBeenCalledWith("voice_runtime_birth", { provider: "openai" });
  expect(native.invoke).toHaveBeenCalledWith("voice_generation_bind", { birth: "narration-birth", generation, environment: "host", thread: "room" });
  expect(voiceGenerationStatus(input(generation), source)).toEqual({ generationKey: generation, active: true });
  expect(() => voiceGenerationStatus(input(generation), { ...source, threadId: "other" })).toThrow("unavailable");
  closeVoiceRuntimeEvidence(runtime, closed.promise);
  recordVoiceGenerationClosure(generation, closed.promise);
  ready = false;
  expect(() => voiceGenerationStatus(input(generation), source)).toThrow("unavailable");
  expect(native.invoke).not.toHaveBeenCalledWith("voice_runtime_closed", expect.anything());
  closed.resolve();
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith("voice_runtime_closed", { birth: "narration-birth" }));
  expect(await retireVoiceGeneration(input(generation), source)).toEqual({ retired: true, generationKey: generation });
  expect(() => associateVoiceGeneration({}, generation)).toThrow("runtime changed");
});
it("does not report a successful Native binding when the runtime was never registered", async () => {
  associateVoiceGeneration({}, "missing-birth");
  await expect(bindVoiceGeneration("missing-birth", source)).rejects.toThrow("registration unavailable");
});
it("reports only current output readiness for the exact Room generation", () => {
  let ready = true;
  registerVoiceGenerationRetirement("status-generation", () => source, async () => {}, () => ready);
  expect(voiceGenerationStatus(input("status-generation"), source)).toEqual({ generationKey: "status-generation", active: true });
  expect(() => voiceGenerationStatus(input("status-generation"), { ...source, threadId: "other" })).toThrow("unavailable");
  ready = false;
  expect(() => voiceGenerationStatus(input("status-generation"), source)).toThrow("unavailable");
});
it("persists closure only after both actual runtime settlement and registration", async () => {
  const closure = Promise.withResolvers<void>();
  const binding = Promise.withResolvers<void>();
  native.invoke.mockImplementation((name: string) => {
    if (name === "voice_runtime_birth") return Promise.resolve("birth");
    if (name === "voice_generation_bind") return binding.promise;
    return Promise.resolve();
  });
  const runtime = {};
  await beginVoiceRuntime(runtime, "openai");
  associateVoiceGeneration(runtime, "bound-generation");
  const associated = bindVoiceGeneration("bound-generation", source);
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith("voice_generation_bind", expect.anything()));
  closeVoiceRuntimeEvidence(runtime, closure.promise);
  closure.resolve();
  await Promise.resolve();
  expect(native.invoke).not.toHaveBeenCalledWith("voice_runtime_closed", expect.anything());
  binding.resolve();
  await associated;
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith("voice_runtime_closed", { birth: "birth" }));
});
it("reconciles a normal closed generation without restarting runtime cleanup", async () => {
  const retire = vi.fn(async () => {});
  registerVoiceGenerationRetirement("normally-closed", () => source, retire);
  recordVoiceGenerationClosure("normally-closed", Promise.resolve());
  await Promise.resolve();
  expect(await retireVoiceGeneration(input("normally-closed"), source)).toMatchObject({
    retired: true,
  });
  expect(retire).not.toHaveBeenCalled();
});
it("waits actual runtime settlement and coalesces retirement without reconnecting", async () => {
  const settled = Promise.withResolvers<void>();
  const retire = vi.fn(() => settled.promise);
  registerVoiceGenerationRetirement("runtime", () => source, retire);
  let acknowledged = false;
  const first = retireVoiceGeneration(input("runtime"), source).then((value) => {
    acknowledged = true;
    return value;
  });
  const duplicate = retireVoiceGeneration(input("runtime"), source);
  await Promise.resolve();
  expect(acknowledged).toBe(false);
  expect(retire).toHaveBeenCalledOnce();
  settled.resolve();
  expect(await first).toEqual({ retired: true, generationKey: "runtime" });
  await duplicate;
  expect(await retireVoiceGeneration(input("runtime"), source)).toMatchObject({ retired: true });
  expect(retire).toHaveBeenCalledOnce();
});
it("cannot attest an unknown generation, another Room or failed runtime cleanup", async () => {
  await expect(retireVoiceGeneration(input("unknown"), source)).rejects.toThrow("unavailable");
  const retire = vi.fn(async () => {
    throw new Error("Socket closure unconfirmed");
  });
  registerVoiceGenerationRetirement("failed-runtime", () => source, retire);
  await expect(
    retireVoiceGeneration(input("failed-runtime"), { ...source, threadId: "other" }),
  ).rejects.toThrow("unavailable");
  expect(retire).not.toHaveBeenCalled();
  await expect(retireVoiceGeneration(input("failed-runtime"), source)).rejects.toThrow(
    "unconfirmed",
  );
  expect(retire).toHaveBeenCalledOnce();
});
