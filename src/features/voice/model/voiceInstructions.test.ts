import { beforeEach, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";

const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../../../integrations/harness", () => ({
  runHarnessTextPrompt: run,
  canRunHarnessTextPrompt: () => true,
  warmupHarnessText: vi.fn(),
}));
vi.mock("../../../platform/tauri/fs", () => ({ homeDir: vi.fn(async () => "/home") }));
import { converseWithAssistant } from "./voiceAssistant";
import { VOICE_SHARED_POLICY, voiceInstructions } from "./voiceInstructions";
import { buildVoicePrompt } from "./voicePrompt";
import { voiceWorkRefusal } from "./voiceWorkAdmission";

it("accepts a clicked draft without treating a displayed form as consent to send", () => {
  const decision = (pressed: boolean, submit: boolean) =>
    voiceWorkRefusal(
      "Show my sessions",
      "app_tool_call",
      "workspace.sessions.create",
      undefined,
      { prompt: "Edited in the form", submit },
      "workspace",
      pressed,
    );
  expect(decision(true, false)).toBeUndefined();
  expect(decision(false, false)?.accepted).toBe(false);
  expect(decision(true, true)?.accepted).toBe(false);
});

beforeEach(() => run.mockReset());

it("uses the same policy text in the realtime and local prompts", async () => {
  run.mockResolvedValue('{"type":"reply","text":"ok"}');
  await converseWithAssistant({
    session: {
      id: "s",
      cwd: "/p",
      harness: "grok",
      model: "grok-4.6",
      blocks: [],
    } as unknown as Session,
    transcript: "hi",
    context: {},
    signal: new AbortController().signal,
    tools: [{ name: "app_context" }],
    execute: vi.fn(),
  });
  expect(run.mock.calls[0]![0].prompt).toContain(VOICE_SHARED_POLICY);
  expect(voiceInstructions("en")).toContain(VOICE_SHARED_POLICY);
  expect(VOICE_SHARED_POLICY).toContain("give_jobs");
});

it("keeps absolute paths out of spoken replies by default on every route", () => {
  for (const prompt of [
    voiceInstructions("tr"),
    VOICE_SHARED_POLICY,
    buildVoicePrompt({}, "", []),
  ]) {
    expect(prompt).toContain(
      "Only say an absolute filesystem path if the owner explicitly asks for the full path.",
    );
    expect(prompt).toContain("Use the project, folder, or file name in spoken replies");
  }
});

it("tells the assistant to ask instead of going silent after a failure or a dropped turn", async () => {
  const { VOICE_SHARED_POLICY, voiceInterruptedTurnNotice } = await import("./voiceInstructions");
  expect(VOICE_SHARED_POLICY).toContain("never ends the turn in silence");
  const notice = voiceInterruptedTurnNotice(`  ${"x".repeat(400)}  `);
  expect(notice).toContain("do not repeat any action until they answer");
  expect(notice).not.toContain("x".repeat(301));
  expect(notice).toContain("Work this voice assistant started");
  expect(notice).toContain("never say work was not started unless that state confirms it");
});

it("routes build requests to a session by default and answers from recorded work state", () => {
  expect(VOICE_SHARED_POLICY).toContain("goes by default to a normal coding session");
  expect(VOICE_SHARED_POLICY).toContain(
    "Use give_jobs, tasks, goals or crews only when the owner explicitly asks",
  );
  expect(VOICE_SHARED_POLICY).toContain("Ask at most one clarifying question");
  expect(VOICE_SHARED_POLICY).toContain(
    'the seeded block titled "Work this voice assistant started"',
  );
  expect(VOICE_SHARED_POLICY).toContain("never create the same work twice");
});

it("uses native permission, the latest owner correction and exact post-input observation", () => {
  expect(VOICE_SHARED_POLICY).toContain("category conversation:desktop");
  expect(VOICE_SHARED_POLICY).toContain("without a spoken or choice-card confirmation");
  expect(VOICE_SHARED_POLICY).toContain("Wait for an actual native approval when the tool asks");
  expect(VOICE_SHARED_POLICY).toContain("verify the exact requested result");
  expect(VOICE_SHARED_POLICY).toContain("latest accepted correction, including its exact numbers");
  expect(VOICE_SHARED_POLICY).toContain("Ask only when a necessary owner choice remains");
});

it("routes explicit research in a session to the project workspace", () => {
  const request = "Bir session’da bu konuyu araştırt, session ekranında sonucu göster.";
  expect(
    voiceWorkRefusal(
      request,
      "app_tool_call",
      "workspace.sessions.create",
      undefined,
      {},
      "workspace",
    ),
  ).toBeUndefined();
  expect(voiceWorkRefusal(request, "give_jobs")).toMatchObject({ intent: "normal_session" });
  expect(
    voiceWorkRefusal(
      request,
      "app_tool_call",
      "workspace.sessions.create",
      undefined,
      { submit: true },
      "workspace",
    ),
  ).toBeUndefined();
  expect(voiceWorkRefusal("Session ekranında sonucu göster.", "give_jobs")).toMatchObject({
    intent: "display",
  });
});

it("opens Usage only when the owner asks for that page", () => {
  const decision = (speech: string) =>
    voiceWorkRefusal(speech, "app_tool_call", "workspace.usage.open", undefined, {}, "workspace");
  expect(decision("Open the Usage page.")).toBeUndefined();
  expect(decision("Ayarları aç, Kullanım'a geç.")).toBeUndefined();
  expect(decision("Show my usage this month.")).toMatchObject({ status: "refused" });
  expect(decision("Kullanım ekranını açma.")).toMatchObject({ status: "refused" });
});

it("presents requested text in the call drawer, updates it in place and never overclaims", () => {
  expect(VOICE_SHARED_POLICY).toContain("workspace.live_work.present");
  expect(VOICE_SHARED_POLICY).toMatch(/copy block/i);
  expect(VOICE_SHARED_POLICY).toMatch(/call it again to update the same view/i);
  expect(VOICE_SHARED_POLICY).toMatch(/only status completed means the owner can see it/i);
});
