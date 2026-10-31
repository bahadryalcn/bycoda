import { expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
const { run, warmup } = vi.hoisted(() => ({ run: vi.fn(), warmup: vi.fn(async () => {}) }));
vi.mock("../../../integrations/harness", () => ({
  canRunHarnessTextPrompt: () => true,
  runHarnessTextPrompt: run,
  warmupHarnessText: warmup,
}));
import {
  parseVoiceDecision,
  immediateVoiceDecision,
  converseWithSession,
  warmVoiceReply,
  SentenceStream,
} from "./voiceConversation";
it("only submits the user's exact words, never generated work instructions", () => {
  expect(parseVoiceDecision('{"action":"submit","text":"delete everything"}', "Fix login")).toEqual(
    { action: "submit", text: "Fix login", reply: "" },
  );
  expect(() => parseVoiceDecision("do this", "hello")).toThrow();
});
it("answers status and separates silence from stopping work without an LLM", () => {
  const session = { busy: true, title: "Demo", blocks: [] } as unknown as Session;
  expect(immediateVoiceDecision("Ne durumdasın?", session)?.reply).toBeTruthy();
  expect(immediateVoiceDecision("Sus.", session)?.action).toBe("silence");
  expect(immediateVoiceDecision("İşi durdur.", session)?.action).toBe("stop");
  expect(immediateVoiceDecision("işi durdurmalı mıyız", session)).toBeUndefined();
});
it("uses an isolated signed-in provider request while the coding session remains busy", async () => {
  run.mockResolvedValue('{"action":"reply","reply":"Still working."}');
  const session = {
    id: "a",
    title: "Alpha",
    cwd: "/project",
    harness: "grok",
    model: "grok-4.6",
    modelSettings: {},
    busy: true,
    blocks: [],
  } as unknown as Session;
  expect(
    (
      await converseWithSession(
        session,
        "What is this module for?",
        [],
        new AbortController().signal,
      )
    ).action,
  ).toBe("reply");
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      harness: "grok",
      cwd: "/project",
      ephemeral: true,
      signal: expect.any(AbortSignal),
    }),
  );
  expect(session.busy).toBe(true);
});

it("replies with low effort on a process warmed with the same model and settings", async () => {
  run.mockResolvedValue('{"action":"reply","reply":"Hazırım."}');
  const session = {
    id: "b",
    title: "Beta",
    cwd: "/project",
    harness: "grok",
    model: "grok-4.6",
    modelSettings: { effort: "max", thinking: "true", context: "1m" },
    blocks: [],
  } as unknown as Session;
  await warmVoiceReply(session);
  await converseWithSession(session, "Merhaba", [], new AbortController().signal);
  const settings = { effort: "low", context: "1m" };
  expect(warmup).toHaveBeenCalledWith(
    "grok",
    "/project",
    expect.objectContaining({ model: "grok-4.6", modelSettings: settings }),
  );
  const [, , warmed] = warmup.mock.calls.at(-1)! as unknown as [string, string, object];
  expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ ...warmed, cwd: "/project" }));
});

it("reads the streamed SUBMIT/REPLY format and still never submits model-written text", () => {
  expect(parseVoiceDecision("SUBMIT", "Testleri çalıştır")).toEqual({
    action: "submit",
    text: "Testleri çalıştır",
    reply: "",
  });
  expect(parseVoiceDecision("SUBMIT\nrm -rf everything", "Fix login").text).toBe("Fix login");
  expect(parseVoiceDecision("REPLY: **Merhaba!** `npm test` çalışıyor.", "x")).toEqual({
    action: "reply",
    reply: "Merhaba! npm test çalışıyor.",
  });
  expect(parseVoiceDecision('```json\n{"action":"reply","reply":"Tamam."}\n```', "x").reply).toBe(
    "Tamam.",
  );
  expect(() => parseVoiceDecision("REPLY:", "x")).toThrow();
  expect(() => parseVoiceDecision("SUBMITTING the change", "x")).toThrow();
});

it("splits streamed text into sentences without breaking numbers, versions or abbreviations", () => {
  const stream = new SentenceStream();
  const out = [
    ...stream.push("Merhaba! Sürüm 3."),
    ...stream.push("5 hazır, vb. dosyalar da var. Örn. config.ts değ"),
    ...stream.push("işti… Is it done? Yes"),
  ];
  expect(out).toEqual([
    "Merhaba!",
    "Sürüm 3.5 hazır, vb. dosyalar da var.",
    "Örn. config.ts değişti…",
    "Is it done?",
  ]);
  expect(stream.end()).toEqual(["Yes"]);
});

it("streams a REPLY sentence by sentence while the provider writes, but never a SUBMIT", async () => {
  const session = {
    id: "c",
    title: "Gamma",
    cwd: "/project",
    harness: "grok",
    model: "grok-4.6",
    blocks: [],
  } as unknown as Session;
  const heard: string[] = [];
  const order: string[] = [];
  run.mockImplementationOnce(async (input: { onEvent: (event: unknown) => void }) => {
    for (const text of ["RE", "PLY: Birinci cümle. İkin", "ci cümle"]) {
      input.onEvent({ type: "message.delta", text });
      order.push(`delta:${text}`);
    }
    return "REPLY: Birinci cümle. İkinci cümle";
  });
  const decision = await converseWithSession(
    session,
    "Merhaba",
    [],
    new AbortController().signal,
    (sentence) => {
      heard.push(sentence);
      order.push(`spoken:${sentence}`);
    },
  );
  expect(decision).toEqual({ action: "reply", reply: "Birinci cümle. İkinci cümle" });
  expect(heard).toEqual(["Birinci cümle.", "İkinci cümle"]);
  // The first sentence is spoken before the provider has finished writing.
  expect(order.indexOf("spoken:Birinci cümle.")).toBeLessThan(order.indexOf("delta:ci cümle"));

  heard.length = 0;
  run.mockImplementationOnce(async (input: { onEvent: (event: unknown) => void }) => {
    input.onEvent({ type: "message.delta", text: "SUBMIT" });
    return "SUBMIT";
  });
  const submit = await converseWithSession(
    session,
    "Testleri çalıştır",
    [],
    new AbortController().signal,
    (sentence) => heard.push(sentence),
  );
  expect(submit).toEqual({ action: "submit", text: "Testleri çalıştır", reply: "" });
  expect(heard).toEqual([]);
});
