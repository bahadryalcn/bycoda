// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  forgetHostVoiceMemory,
  migrateVoiceOwnerMemory,
  rememberHostVoiceMemory,
} from "./voiceHostMemory";
import { loadVoiceSettings } from "./voiceSettings";
import { saveVoiceMemory } from "./voiceMemory";
import { DEFAULT_VOICE_PERSONA, saveVoicePersona } from "./voicePersona";
import type {
  AssistantMemory,
  AssistantRequest,
  AssistantSnapshot,
} from "../../../shared/model/host-contracts/assistant";
afterEach(() => localStorage.clear());
it("migrates owner rules and enabled notes once while retaining the legacy backups", async () => {
  saveVoicePersona({ ...DEFAULT_VOICE_PERSONA, rules: "Never interrupt me" });
  saveVoiceMemory({ enabled: true, notes: [{ id: "one", text: "Prefers Turkish", at: 1 }] });
  const saved: AssistantMemory[] = [];
  const request = vi.fn(async (input: AssistantRequest) => {
    if (input.op === "memory.search") return { entries: saved };
    if (input.op === "memory.save") {
      const memory = { ...input, id: "m" + saved.length } as unknown as AssistantMemory;
      saved.push(memory);
      return { memory };
    }
    return {};
  });
  const snapshot = { profile: { setupComplete: true } } as AssistantSnapshot;
  await migrateVoiceOwnerMemory(snapshot, request);
  await migrateVoiceOwnerMemory(snapshot, request);
  expect(saved.map((value) => value.text)).toEqual(["Never interrupt me", "Prefers Turkish"]);
  expect(localStorage.getItem("bycoda.voice.persona")).toContain("Never interrupt me");
  expect(localStorage.getItem("bycoda.voice.memory")).toContain("Prefers Turkish");
});
it("does not save when disabled and refuses model-generated rule promotion", async () => {
  saveVoiceMemory({ enabled: false, notes: [] });
  const request = vi.fn();
  expect(await rememberHostVoiceMemory("Don't interrupt me", "rule", request)).toMatchObject({
    saved: false,
  });
  expect(request).not.toHaveBeenCalled();
  saveVoiceMemory({ enabled: true, notes: [] });
  expect(await rememberHostVoiceMemory("Don't interrupt me", "rule", request)).toMatchObject({
    saved: false,
    error: "Only your current explicit correction can create an owner rule.",
  });
  expect(request).not.toHaveBeenCalled();
  expect(loadVoiceSettings().turnEndSilence).toBeUndefined();
});
it("never downgrades an owner rule when a model remembers the same fact", async () => {
  saveVoiceMemory({ enabled: true, notes: [] });
  const rule = {
    id: "owner-rule",
    version: 4,
    kind: "rule",
    scope: "all",
    text: "I prefer short answers",
    active: true,
  } as AssistantMemory;
  const request = vi.fn(async (input: AssistantRequest) =>
    input.op === "memory.search"
      ? { entries: [rule] }
      : input.op === "memory.save"
        ? { memory: { ...input, id: "new-fact" } as unknown as AssistantMemory }
        : {},
  );
  expect(
    await rememberHostVoiceMemory(
      rule.text,
      "fact",
      request,
      "  Remember I prefer short answers.  ",
    ),
  ).toMatchObject({ saved: true, id: "new-fact" });
  const save = request.mock.calls
    .map(([input]) => input)
    .find((input) => input.op === "memory.save");
  expect(save).toMatchObject({ kind: "fact", quote: "  Remember I prefer short answers.  " });
  expect(save).not.toHaveProperty("id");
  expect(rule.kind).toBe("rule");
});
it("requires a positive owner forget request and refuses changed confirmed records", async () => {
  saveVoiceMemory({ enabled: true, notes: [] });
  const entry = {
    id: "owner-rule",
    version: 4,
    text: "Never mention bananas",
    kind: "rule",
  } as AssistantMemory;
  const request = vi.fn(async (input: AssistantRequest) =>
    input.op === "memory.search" ? { entries: [entry] } : {},
  );
  const confirmed = { version: 4, text: entry.text };
  expect(
    await forgetHostVoiceMemory(entry.id, request, "Don't forget this rule", confirmed),
  ).toMatchObject({ forgotten: false });
  expect(request).not.toHaveBeenCalled();
  expect(
    await forgetHostVoiceMemory(entry.id, request, "Forget this rule", {
      ...confirmed,
      version: 3,
    }),
  ).toMatchObject({ forgotten: false });
  expect(request.mock.calls.some(([input]) => input.op === "memory.delete")).toBe(false);
  expect(await forgetHostVoiceMemory(entry.id, request, "Forget this rule", confirmed)).toEqual({
    forgotten: true,
  });
  expect(request).toHaveBeenLastCalledWith({
    op: "memory.delete",
    id: entry.id,
    expectedVersion: 4,
  });
});
