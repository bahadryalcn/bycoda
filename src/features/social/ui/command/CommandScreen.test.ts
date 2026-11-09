// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialClient } from "../../model/socialClient";
import { CommandScreen } from "./CommandScreen";

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

const feed = [
  {
    id: "act-1",
    at: Date.now(),
    actor: "owner",
    action: "lists.addMembers",
    summary: "lists.addMembers · account a1",
    status: "done",
    undo: { action: "lists.removeMembers", input: { listId: "l1", personIds: ["p1"] } },
  },
];

function fakeClient(overrides: { command?: () => Promise<unknown> } = {}) {
  const ai = {
    summary: vi.fn(async () => ({
      sentToday: 3,
      pending: 1,
      newPeople: 2,
      replyRate: 0.5,
      waitingForYou: 0,
    })),
    actions: vi.fn(async () => ({ items: feed })),
    command: vi.fn(overrides.command ?? (async () => plan)),
    runPlan: vi.fn(async () => ({ results: [{ stepId: "s2", status: "done" }] })),
    undo: vi.fn(async () => ({})),
    stop: vi.fn(async () => ({ stopped: true })),
    resume: vi.fn(async () => ({ stopped: false })),
    report: vi.fn(async () => ({ done: [], results: [], suggestions: [] })),
  };
  const client = {
    snapshot: vi.fn(async () => ({ aiStopped: false })),
    request: vi.fn(async () => ({ global: {}, platforms: {} })),
    browser: { needsHuman: { list: vi.fn(async () => ({ items: [] })) } },
    ai,
  };
  return client as unknown as SocialClient & { ai: typeof ai };
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

async function typeCommand(value: string) {
  const area = element.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(button: HTMLButtonElement | undefined) {
  expect(button).toBeDefined();
  await act(async () => {
    button!.click();
  });
  await settle();
}

function render(client: SocialClient) {
  act(() =>
    root.render(
      createElement(CommandScreen, {
        client,
        machineId: "m1",
        shellState: { hostOnline: true, unreachable: false, aiStopped: false },
        active: true,
        onNavigate: vi.fn(),
      }),
    ),
  );
}

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

it("sends the typed sentence to ai.command and lists the planned steps", async () => {
  const client = fakeClient();
  render(client);
  await settle();
  await typeCommand("Reply to the pricing questions");
  await click(buttonWithText("Plan"));
  expect(client.ai.command).toHaveBeenCalledWith({ text: "Reply to the pricing questions" });
  expect(element.textContent).toContain("Reply to the pricing question");
  expect(element.textContent).toContain("Needs your approval");
  expect(element.textContent).toContain("Will run automatically");
});

it("runs the plan with only the steps the owner approved", async () => {
  const client = fakeClient();
  render(client);
  await settle();
  await typeCommand("Plan it");
  await click(buttonWithText("Plan"));
  await click(buttonWithText("Approve"));
  await click(buttonWithText("Run plan"));
  expect(client.ai.runPlan).toHaveBeenCalledWith({ planId: "plan-1", approvedStepIds: ["s1"] });
});

it("leaves the global AI stop to the shell bar, not the Command screen", async () => {
  const client = fakeClient();
  render(client);
  await settle();
  expect(buttonWithText("Stop all AI")).toBeUndefined();
  expect(buttonWithText("Resume AI")).toBeUndefined();
  expect(client.ai.stop).not.toHaveBeenCalled();
});

it("undoes an activity row through ai.actions.undo", async () => {
  const client = fakeClient();
  render(client);
  await settle();
  await click(buttonWithText("Undo"));
  expect(client.ai.undo).toHaveBeenCalledWith("act-1");
});

it("shows the four summary cards from ai.summary", async () => {
  const client = fakeClient();
  render(client);
  await settle();
  const values = [...element.querySelectorAll(".command-card-value")].map(
    (node) => node.textContent,
  );
  expect(values).toEqual(["3", "1", "2", "50%"]);
});

it("shows a Host failure on the screen instead of hiding it", async () => {
  const client = fakeClient({
    command: async () => {
      throw new Error("Connect a social account before asking AI to plan.");
    },
  });
  render(client);
  await settle();
  await typeCommand("Plan");
  await click(buttonWithText("Plan"));
  expect(element.textContent).toContain("Connect a social account before asking AI to plan.");
});
