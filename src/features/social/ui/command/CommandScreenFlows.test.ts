// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AI_MODEL_REQUIRED_MESSAGE } from "../../model/socialTools";
import type { SocialClient } from "../../model/socialClient";
import { CommandScreen } from "./CommandScreen";
import { useCommandScreen } from "./useCommandScreen";

// The app's model picker is a large session control; the setup card only needs its onChange contract.
vi.mock("../../../sessions/public/ModelPicker", async () => {
  const { createElement: h } = await import("react");
  return {
    ModelPicker: (props: { onChange: (harness: string, model: string) => void }) =>
      h("button", { onClick: () => props.onChange("codex", "fixture-model") }, "Pick model"),
  };
});

let element: HTMLDivElement;
let root: Root;

const plan = {
  planId: "plan-1",
  steps: [
    {
      id: "s1",
      action: "replies.send",
      input: {},
      summary: "Reply to the pricing question",
      needsApproval: true,
    },
    { id: "s2", action: "lists.list", input: {}, summary: "Show lists", needsApproval: false },
  ],
};

type Overrides = {
  command?: () => Promise<unknown>;
  undo?: () => Promise<unknown>;
  actions?: () => Promise<unknown>;
  snapshot?: () => Promise<unknown>;
};

function fakeClient(overrides: Overrides = {}) {
  const ai = {
    summary: vi.fn(async () => ({
      sentToday: 0,
      pending: 0,
      newPeople: 0,
      replyRate: 0,
      waitingForYou: 0,
    })),
    actions: vi.fn(
      overrides.actions ??
        (async () => ({
          items: [
            {
              id: "act-1",
              at: Date.now(),
              actor: "owner",
              action: "lists.addMembers",
              summary: "lists.addMembers · account a1",
              status: "done",
              undo: { action: "lists.removeMembers", input: {} },
            },
          ],
        })),
    ),
    command: vi.fn(overrides.command ?? (async () => plan)),
    runPlan: vi.fn(async () => ({ results: [{ stepId: "s2", status: "done" }] })),
    undo: vi.fn(overrides.undo ?? (async () => ({}))),
    stop: vi.fn(async () => ({ aiStopped: true })),
    resume: vi.fn(async () => ({ aiStopped: false })),
    report: vi.fn(async () => ({ done: [], results: [], suggestions: [] })),
  };
  const request = vi.fn(async (action: string) => {
    if (action === "policy.get") return { global: { keep: true }, platforms: {} };
    return {};
  });
  const client = {
    snapshot: vi.fn(overrides.snapshot ?? (async () => ({ aiStopped: false }))),
    request,
    browser: { needsHuman: { list: vi.fn(async () => ({ items: [] })) } },
    ai,
  };
  return client as unknown as SocialClient & { ai: typeof ai; request: typeof request };
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return [...element.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  );
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const area = () => element.querySelector("textarea") as HTMLTextAreaElement;

async function typeCommand(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(area(), value);
    area().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(button: HTMLButtonElement | undefined) {
  expect(button).toBeDefined();
  await act(async () => {
    button!.click();
  });
  await settle();
}

async function mount(client: SocialClient, projectId?: string) {
  act(() =>
    root.render(
      createElement(CommandScreen, {
        client,
        machineId: "m1",
        projectId,
        shellState: { hostOnline: true, unreachable: false, aiStopped: false },
        active: true,
        onNavigate: vi.fn(),
      }),
    ),
  );
  await settle();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

it("plans for the selected project only", async () => {
  const client = fakeClient();
  await mount(client, "project-1");
  await typeCommand("Reply to the pricing questions");
  await click(buttonWithText("Plan"));
  expect(client.ai.command).toHaveBeenCalledExactlyOnceWith({
    text: "Reply to the pricing questions",
    projectId: "project-1",
  });
});

it("changes nothing when a plan is made: the plan is shown for review and the box is cleared", async () => {
  const client = fakeClient();
  await mount(client);
  await typeCommand("Plan it");
  await click(buttonWithText("Plan"));
  expect(element.textContent).toContain("Reply to the pricing question");
  expect(area().value).toBe("");
  expect(client.ai.runPlan).not.toHaveBeenCalled();
  expect(client.ai.stop).not.toHaveBeenCalled();
  expect(client.ai.undo).not.toHaveBeenCalled();
  expect(client.request).not.toHaveBeenCalled();
});

it("runs a plan with no approved steps when the owner approves nothing", async () => {
  const client = fakeClient();
  await mount(client);
  await typeCommand("Plan it");
  await click(buttonWithText("Plan"));
  await click(buttonWithText("Run plan"));
  expect(client.ai.runPlan).toHaveBeenCalledExactlyOnceWith({
    planId: "plan-1",
    approvedStepIds: [],
  });
  const labels = [...element.querySelectorAll(".command-step-status")].map((n) => n.textContent);
  expect(labels).toEqual(["Needs your approval", "Done"]);
  expect(client.ai.actions.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it("keeps the typed request and lets the owner try again after the AI fails", async () => {
  const command = vi
    .fn()
    .mockRejectedValueOnce(new Error("Provider unavailable"))
    .mockResolvedValueOnce(plan);
  const client = fakeClient({ command });
  await mount(client);
  await typeCommand("Weekly posts");
  await click(buttonWithText("Plan"));
  expect(element.textContent).toContain("Provider unavailable");
  expect(area().value).toBe("Weekly posts");
  expect(buttonWithText("Plan")?.disabled).toBe(false);
  expect(client.ai.runPlan).not.toHaveBeenCalled();
  await click(buttonWithText("Plan"));
  expect(command).toHaveBeenCalledTimes(2);
  expect(element.textContent).not.toContain("Provider unavailable");
  expect(element.textContent).toContain("Reply to the pricing question");
});

it("shows the setup card instead of a generic error when no AI model is set, and saves only the model", async () => {
  const client = fakeClient({
    command: async () => {
      throw new Error(AI_MODEL_REQUIRED_MESSAGE);
    },
  });
  await mount(client);
  await typeCommand("Weekly posts");
  await click(buttonWithText("Plan"));
  expect(element.textContent).toContain("Choose an AI model");
  expect(element.textContent).not.toContain(AI_MODEL_REQUIRED_MESSAGE);
  expect(client.ai.runPlan).not.toHaveBeenCalled();
  await click(buttonWithText("Pick model"));
  await click(buttonWithText("Use this model"));
  const calls = client.request.mock.calls as unknown as [string, Record<string, unknown>?][];
  expect(calls[0]?.[0]).toBe("policy.get");
  const save = calls.find(([action]) => action.startsWith("policy.save"));
  expect(save).toBeDefined();
  expect(save?.[1]?.policies).toMatchObject({
    global: { keep: true, agent: { provider: "codex", model: "fixture-model" } },
  });
  expect(calls).toHaveLength(2);
  expect(element.textContent).not.toContain("Choose an AI model");
  expect(client.ai.runPlan).not.toHaveBeenCalled();
});

it("renders no stop or resume control even when the Host reports AI as stopped", async () => {
  const client = fakeClient({ snapshot: async () => ({ aiStopped: true }) });
  await mount(client);
  expect(buttonWithText("Stop all AI")).toBeUndefined();
  expect(buttonWithText("Resume AI")).toBeUndefined();
  expect(client.ai.stop).not.toHaveBeenCalled();
});

it("names an undo that the Host refused and keeps the row", async () => {
  const client = fakeClient({
    undo: async () => {
      throw new Error("The list no longer exists.");
    },
  });
  await mount(client);
  await click(buttonWithText("Undo"));
  expect(element.textContent).toContain("The list no longer exists.");
  expect(buttonWithText("Undo")).toBeDefined();
});

it("names a failed activity read instead of reporting that nothing has happened", async () => {
  const client = fakeClient({
    actions: async () => {
      throw new Error("Host unreachable");
    },
  });
  await mount(client);
  expect(element.textContent).toContain("Could not load AI activity.");
  expect(element.textContent).not.toContain("Nothing has happened yet.");
});

it("saves the first-use model through the reviewed policy path, keeping the rest of the policy", async () => {
  const client = fakeClient();
  const probeRoot = createRoot(document.createElement("div"));
  let save!: ReturnType<typeof useCommandScreen>["saveModel"];
  function Probe() {
    save = useCommandScreen(client).saveModel;
    return null;
  }
  act(() => probeRoot.render(createElement(Probe)));
  await act(async () => {
    save({ provider: "claude", model: "m" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(client.request.mock.calls.map((call) => call[0])).not.toContain("policy.save");
  expect(client.request).toHaveBeenCalledWith("policy.saveReviewed", {
    policies: { global: { keep: true, agent: { provider: "claude", model: "m" } }, platforms: {} },
    expectedPolicies: { global: { keep: true }, platforms: {} },
    confirm: "UPDATE_SOCIAL_POLICY",
  });
  act(() => probeRoot.unmount());
});

it("keeps text entered after planning began", async () => {
  let resolve!: (value: typeof plan) => void;
  const client = fakeClient({
    command: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  await mount(client);
  await typeCommand("First revision");
  await click(buttonWithText("Plan"));
  await typeCommand("Next request");
  await act(async () => resolve(plan));
  expect(area().value).toBe("Next request");
});
