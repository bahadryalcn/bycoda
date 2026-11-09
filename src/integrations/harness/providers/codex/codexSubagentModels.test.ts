import { processConstructions } from "../processConstruction.testSupport";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HarnessEvent } from "../../core/types";

const mock = vi.hoisted(() => ({
  lines: [] as string[],
  onLine: undefined as ((line: string) => void) | undefined,
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("../../core/child", () =>
  processConstructions.mock({
    resolveCodexBinary: async () => ({ path: "/fake/codex" }),
    spawnChild: async () => undefined,
    killChild: async () => undefined,
    unwatchChild: () => undefined,
    watchChild: (_id: string, line: (value: string) => void) => {
      mock.onLine = line;
    },
    writeChild: async (_id: string, line: string) => {
      mock.lines.push(line);
    },
  }),
);
vi.mock("../../../../platform/tauri/generatedImages", () => ({
  saveGeneratedImage: vi.fn(),
  deleteGeneratedImages: vi.fn(),
}));

const codex = await import("./codex");
const frames = () => mock.lines.map((line) => JSON.parse(line));
const notify = (method: string, params: unknown) =>
  mock.onLine!(JSON.stringify({ method, params }));
async function answer(method: string, result: unknown) {
  await vi.waitFor(() => expect(frames().some((frame) => frame.method === method)).toBe(true));
  mock.onLine!(
    JSON.stringify({ id: frames().find((frame) => frame.method === method).id, result }),
  );
}

beforeEach(() => {
  processConstructions.reset();
  mock.lines.length = 0;
  mock.onLine = undefined;
  codex.__codexTestReset();
});
afterEach(() => codex.__codexTestReset());

it("names an inheriting child's model and keeps an explicit override", async () => {
  const events: HarnessEvent[] = [];
  const turn = codex.sendCodexTurn({
    sessionId: "s1",
    cwd: "/repo",
    model: "codex:gpt-5.4",
    modelSettings: {},
    runtimeMode: "supervised",
    text: "summarize the changelog",
    attachments: [],
    onEvent: (event) => events.push(event),
  });
  await answer("initialize", {});
  await answer("thread/start", { thread: { id: "thr_1" } });
  await answer("turn/start", { turn: { id: "turn_1", status: "inProgress" } });
  notify("turn/started", { turn: { id: "turn_1", status: "inProgress" } });
  notify("item/started", {
    threadId: "thr_1",
    item: {
      id: "act_1",
      type: "subAgentActivity",
      kind: "started",
      agentPath: "/root/sohbet_06",
      agentsStates: { thr_a: { status: "running" } },
      receiverThreadIds: ["thr_a"],
    },
  });
  notify("item/started", {
    threadId: "thr_1",
    item: {
      id: "spawn_b",
      type: "collabAgentToolCall",
      tool: "spawnAgent",
      status: "inProgress",
      model: "gpt-5.4-mini",
      prompt: "Quick check",
      receiverThreadIds: ["thr_b"],
    },
  });
  notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
  notify("turn/completed", { threadId: "thr_a", turn: { id: "ta", status: "completed" } });
  notify("turn/completed", { threadId: "thr_b", turn: { id: "tb", status: "completed" } });
  await turn;

  const models = (callId: string) =>
    events
      .filter((event) => event.type === "tool.started" || event.type === "tool.updated")
      .filter((event) => event.callId === callId && event.agentModel)
      .map((event) => event.agentModel);
  expect(models("act_1")).toEqual(["gpt-5.4"]);
  expect(models("spawn_b")).toEqual(["gpt-5.4-mini"]);
});
