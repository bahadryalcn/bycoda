// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CrewRunView } from "../model/crewClient";
import { CrewWorkDetail } from "./CrewWorkDetail";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const agent = (id: string, role: string, name: string) => ({
  id,
  name,
  role,
  selection: "fixed",
  candidates: [],
});

function run(status: "active" | "paused"): CrewRunView {
  return {
    id: "run",
    title: "Ship the release",
    status,
    updatedAt: 1,
    coordinatorStatus: "idle",
    coordinatorSessionId: "lead-session",
    definition: {
      id: "def",
      name: "Team",
      agents: [agent("lead", "coordinator", "Team Lead"), agent("dev", "specialist", "Developer")],
    },
    tasks: [],
    messages: [],
    assignments: [],
  } as unknown as CrewRunView;
}

async function render(view: CrewRunView, call = vi.fn().mockResolvedValue({})) {
  await act(async () =>
    root.render(
      createElement(CrewWorkDetail, {
        run: view,
        catalog: { providers: [] } as never,
        pending: false,
        pendingAction: null,
        canOpen: true,
        canDelete: false,
        ownerTools: { machineId: "m", call, tasksSupported: true },
        onOpen: vi.fn(),
        onPause: vi.fn(),
        onStop: vi.fn(),
        onDelete: vi.fn(),
      }),
    ),
  );
  return call;
}

const button = (name: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === name);

it("shows Resume as the paused signal without a paused sentence or accordions", async () => {
  await render(run("paused"));
  expect(button("Resume")).toBeTruthy();
  expect(button("Pause")).toBeUndefined();
  expect(container.textContent).not.toContain("Work is paused");
  expect(container.querySelector("details, [aria-expanded]:not([aria-haspopup])")).toBeNull();
});

it("offers Pause and Stop while active and one composer to the lead", async () => {
  await render(run("active"));
  expect(button("Pause")).toBeTruthy();
  expect(button("Stop")).toBeTruthy();
  expect(container.querySelectorAll("textarea")).toHaveLength(1);
  expect(button("Send")).toBeTruthy();
});

it("sends a note to the lead through the existing request operation", async () => {
  const call = await render(run("active"));
  const box = container.querySelector("textarea")!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    set.call(box, "Check the logs");
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Send")!.click());
  expect(call).toHaveBeenCalledWith(
    "crews.request",
    expect.objectContaining({ runId: "run", text: expect.stringContaining("Check the logs") }),
  );
});
