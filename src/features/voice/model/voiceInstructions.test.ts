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
