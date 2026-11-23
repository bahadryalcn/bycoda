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
});
