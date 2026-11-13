import { processConstructions } from "../processConstruction.testSupport";
import { captureNativeOutputEvent } from "../../core/nativeOutputDelivery.testSupport";
import { beforeEach, expect, vi } from "vitest";

export const sent: string[] = [];
export let onLine: ((line: string) => void) | undefined;
export let onExit: ((code: number | null, reason?: string) => void) | undefined;
export const killChild = vi.fn(async (): Promise<void> => undefined);
export const writeChild = vi.fn(async (_id: string, line: string) => {
  sent.push(line);
});
const saveGeneratedImage = vi.hoisted(() =>
  vi.fn(async () => ({
    path: "/app-data/generated-images/image.png",
    mimeType: "image/png",
    size: 8,
  })),
);
const deleteGeneratedImages = vi.hoisted(() => vi.fn(async () => undefined));
const mcpBridge = vi.hoisted(() => vi.fn(async (): Promise<unknown> => null));
vi.mock("../../core/conversationToolsBridge", () => ({ conversationToolsBridge: mcpBridge }));

beforeEach(() => processConstructions.reset());
vi.mock("../../core/child", () =>
  processConstructions.mock({
    resolveCodexBinary: async () => ({ path: "/fake/codex" }),
    spawnChild: async () => undefined,
    killChild,
    unwatchChild: () => undefined,
    watchChild: (_id: string, line: (l: string) => void, exit: typeof onExit) => {
      onLine = line;
      onExit = exit;
    },
    writeChild,
  }),
);

vi.mock("../../../../platform/tauri/generatedImages", () => ({
  saveGeneratedImage,
  deleteGeneratedImages,
}));

export const {
  compactCodexContext,
  steerCodexTurn,
  bindCodexSession,
  cancelCodexTurn,
  keepCodexQuestionOpen,
  respondCodexApproval,
  respondCodexQuestion,
  rewindCodexLastTurn,
  sendCodexTurn,
  stopCodexSession,
  retireOriginalCodexWriter,
  __codexTestReset,
} = await import("./codex");
import type { HarnessEvent, HarnessOperationContext } from "../../core/types";
import type { ControlTurnHandle } from "../../core/controlTurn";
import type { ChildProcessHandle } from "../../core/child";
type RuntimeMode = Parameters<typeof sendCodexTurn>[0]["runtimeMode"];
type TurnIntent = Parameters<typeof sendCodexTurn>[0]["intent"];

export function parse() {
  return sent.map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function reply(id: number, result: unknown) {
  onLine!(JSON.stringify({ id, result }));
}

export function notify(method: string, params: unknown) {
  onLine!(JSON.stringify({ method, params }));
}
export function notifyAsyncQuestion(id: string, turnId = "turn_1") {
  notify("item/completed", {
    threadId: "thr_1",
    turnId,
    item: {
      type: "agentMessage",
      id,
      text: "Which source?\n- Local\n- Remote",
      delivery: "async",
      questions: [{ title: "Which source?", options: ["Local", "Remote"] }],
    },
  });
}
export function withoutTurnIdentity(events: HarnessEvent[]) {
  return events.filter((event) => event.type !== "turn.started");
}

export const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(
    `timed out waiting for ${label}; sent=${JSON.stringify(parse().map((m) => m.method ?? `reply:${m.id}`))}`,
  );
};

export async function startTurn(
  sessionId: string,
  options: {
    runtimeMode?: RuntimeMode;
    nativeControlTurn?: ControlTurnHandle;
    operationContext?: HarnessOperationContext;
    onOriginalProcess?: (handle: ChildProcessHandle) => void;
    intent?: TurnIntent;
    resume?: boolean;
    providerAccountId?: string;
    resumeProviderAccountId?: string;
    expectResume?: boolean;
    beforeThreadReply?: () => Promise<void>;
    onAccepted?: () => void;
    controlsAgents?: boolean;
    text?: string;
    model?: string;
    resolvedModel?: string;
    skillPolicy?: { disabledNames: string[]; disabledPaths: string[] };
    modelSettings?: Record<string, string>;
    mcpConfig?: Record<string, unknown>;
  } = {},
) {
  const events: HarnessEvent[] = [];
  if (options.resume) {
    bindCodexSession(sessionId, "thr_1", "/repo", options.resumeProviderAccountId);
  }
  const turn = sendCodexTurn({
    nativeControlTurn: options.nativeControlTurn,
    operationContext: options.operationContext,
    onOriginalProcess: options.onOriginalProcess,
    sessionId,
    cwd: "/repo",
    model: options.model ?? "codex:gpt-5.4",
    modelSettings: options.modelSettings ?? {},
    skillPolicy: options.skillPolicy,
    providerAccountId: options.providerAccountId,
    runtimeMode: options.runtimeMode ?? "supervised",
    controlsAgents: options.controlsAgents,
    intent: options.intent,
    text: options.text ?? "summarize the changelog",
    attachments: [],
    onAccepted: options.onAccepted,
    onEvent: (event) => {
      captureNativeOutputEvent(sessionId, event);
      events.push(event);
    },
  });

  await waitFor(() => parse().some((m) => m.method === "initialize"), "initialize");
  reply(parse().find((m) => m.method === "initialize")!.id as number, {});
  if (options.mcpConfig) {
    await waitFor(() => parse().some((m) => m.method === "config/read"), "MCP configuration");
    const request = parse().find((m) => m.method === "config/read")!;
    expect(request.params).toEqual({ includeLayers: false, cwd: "/repo" });
    reply(request.id as number, { config: options.mcpConfig });
  }
  if (options.skillPolicy) {
    await waitFor(() => parse().some((m) => m.method === "config/read"), "skill configuration");
    reply(parse().find((m) => m.method === "config/read")!.id as number, {
      config: { skills: { config: [{ path: "/skills/owner-off/SKILL.md", enabled: false }] } },
    });
    // The inventory is only read when the policy disables something.
    if (options.skillPolicy.disabledNames.length || options.skillPolicy.disabledPaths.length) {
      await waitFor(() => parse().some((m) => m.method === "skills/list"), "policy skill list");
      reply(parse().find((m) => m.method === "skills/list")!.id as number, {
        data: [
          {
            skills: [
              { name: "good-css", path: "/skills/good-css/SKILL.md", enabled: true },
              { name: "review", path: "/skills/review/SKILL.md", enabled: true },
            ],
          },
        ],
      });
    }
  }
  const threadMethod = (options.expectResume ?? options.resume) ? "thread/resume" : "thread/start";
  await waitFor(() => parse().some((m) => m.method === threadMethod), threadMethod);
  await options.beforeThreadReply?.();
  reply(parse().find((m) => m.method === threadMethod)!.id as number, {
    thread: { id: "thr_1" },
    model: options.resolvedModel,
  });

  if (options.text?.startsWith("/goal ")) {
    await waitFor(() => parse().some((m) => m.method === "thread/goal/set"), "goal set");
    reply(parse().find((m) => m.method === "thread/goal/set")!.id as number, {
      goal: {
        objective: options.text.slice(6),
        status: "active",
        tokensUsed: 0,
      },
    });
  }
  if (options.text?.startsWith("$")) {
    await waitFor(() => parse().some((m) => m.method === "skills/list"), "skills/list");
    expect(parse().some((m) => m.method === "turn/start")).toBe(false);
    reply(parse().find((m) => m.method === "skills/list")!.id as number, {
      data: [
        {
          cwd: "/repo",
          skills: [{ name: "review", path: "/skills/review/SKILL.md", enabled: true }],
        },
      ],
    });
  }

  await waitFor(() => parse().some((m) => m.method === "turn/start"), "turn/start");
  reply(parse().find((m) => m.method === "turn/start")!.id as number, {
    turn: { id: "turn_1", status: "inProgress" },
  });
  notify("turn/started", { turn: { id: "turn_1", status: "inProgress" } });
  return { events, turn };
}

export function clearOnLine() {
  onLine = undefined;
}

export { saveGeneratedImage, deleteGeneratedImages, mcpBridge };
