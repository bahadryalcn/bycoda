import { beforeEach, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";

const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../../../integrations/harness", () => ({
  runHarnessTextPrompt: run,
  canRunHarnessTextPrompt: () => true,
  warmupHarnessText: vi.fn(),
}));
vi.mock("../../../platform/tauri/fs", () => ({ homeDir: vi.fn(async () => "/home/owner") }));
import { converseWithAssistant } from "./voiceAssistant";

const session = {
  id: "s",
  cwd: "/p",
  harness: "grok",
  model: "grok-4.6",
  blocks: [],
} as unknown as Session;

beforeEach(() => run.mockReset());

it("bounds an oversized local tool result as valid JSON with its small keys", async () => {
  run
    .mockResolvedValueOnce('{"type":"tool","name":"app_tool_call","args":{"requestId":"r"}}')
    .mockResolvedValueOnce('{"type":"reply","text":"ok"}');
  await converseWithAssistant({
    session,
    transcript: "list",
    context: {},
    signal: new AbortController().signal,
    tools: [{ name: "app_tool_call" }],
    execute: vi.fn(async () => ({ status: "ok", nextOffset: 7, rows: "z".repeat(80_000) })),
  });
  const prompt: string = run.mock.calls[1][0].prompt;
  const line = prompt.split("\n").find((entry) => entry.startsWith("TOOL OBSERVATIONS (data): "))!;
  const [observation] = JSON.parse(line.slice("TOOL OBSERVATIONS (data): ".length));
  const result = JSON.parse(observation.result);
  expect(result).toMatchObject({ status: "ok", nextOffset: 7, truncated: true });
});
