// @vitest-environment happy-dom
import { act, createElement } from "react";
import { focusManager } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { LOCAL_SYNC_MACHINE_NAME } from "../../connections/model/localSync";
import type { HostGoal } from "../model/hostGoals";
import type { HostSettingsState } from "../model/hostSettings";
import type { HostSteward } from "../model/hostStewards";
import type { HostTask } from "../model/hostTasks";
import { readTaskInstructions } from "../model/taskInstructions";
import { invalidateMachineSnapshot } from "../../automations/model/machineSnapshot";
import type { DailySummary } from "../model/dailySummary";
import {
  loadStoredDailySummary,
  requestSummaryPanel,
  saveStoredDailySummary,
} from "../model/dailySummaryClient";
import { TasksView as RawTasksView } from "./TasksView";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
const TasksView = withQueryClient(RawTasksView);

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
    isFullscreen: async () => false,
    onFocusChanged: async () => () => {},
  }),
}));

let container: HTMLDivElement;
let root: Root;

// Happy DOM rejects canceled WAAPI promises differently from Chromium. Use
// Motion's JS fallback here; the browser fixture covers real animations.
const animateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
beforeAll(() => {
  Reflect.deleteProperty(Element.prototype, "animate");
});
afterAll(() => {
  if (animateDescriptor) Object.defineProperty(Element.prototype, "animate", animateDescriptor);
});

const task = (overrides: Partial<HostTask>): HostTask => ({
  id: "main",
  title: "Ship the report",
  prompt: "Write the weekly report",
  projectId: "project-1",
  harness: "claude",
  model: "claude:test",
  modelSettings: {},
  runtimeMode: "auto",
  maxRunMinutes: 0,
  status: "queued",
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const goal = (overrides: Partial<HostGoal>): HostGoal => ({
  id: "launch",
  title: "Launch the beta",
  prompt: "Ship the beta",
  projectIds: ["project-1"],
  leadProjectId: "project-1",
  harness: "claude",
  model: "claude:test",
  modelSettings: {},
  runtimeMode: "auto",
  maxRunMinutes: 0,
  verifyDefaults: { review: true },
  approvePlan: true,
  status: "planning",
  taskIds: [],
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

/** A host on this computer holding `tasks`; records what the board asks of it. */
function host(
  tasks: HostTask[],
  capabilities = ["tasks", "tasks.todo"],
  goals: HostGoal[] = [],
  stewards: HostSteward[] = [],
  limits?: HostSettingsState,
) {
  const requests: Array<{ method: string; params: unknown }> = [];
  const fixtureTrees = [
    { path: "/work/project", branch: "main" },
    { path: "/work/integration", branch: "goal/settings" },
  ];
  invoke.mockImplementation(async (command: string, args?: any) => {
    if (command === "remote_machines")
      return [
        {
          id: "machine-local",
          name: LOCAL_SYNC_MACHINE_NAME,
          endpoint: "http://127.0.0.1:3774",
          environmentId: "env-local",
        },
      ];
    if (command !== "remote_request") return null;
    requests.push({ method: args.method, params: args.params });
    if (args.method === "environment.describe")
      return {
        capabilities: [
          ...capabilities,
          "tasks.continue-until-done",
          "goals.direct-checkout",
          "goals.final-review",
        ],
      };
    if (args.method === "projects.list")
      return [{ id: "project-1", cwd: "/work/project", name: "project" }];
    if (args.method === "tasks.list") return tasks;
    if (args.method === "git.branches")
      return { current: "main", branches: fixtureTrees.map((tree) => tree.branch), remotes: [] };
    if (args.method === "git.worktrees") return { worktrees: fixtureTrees };
    if (args.method === "git.worktreeCreate") {
      const tree = { path: "/work/new-integration", branch: args.params.branch };
      fixtureTrees.push(tree);
      return { ...tree, head: "abc" };
    }
    if (args.method === "sessions.get")
      return {
        status: "idle",
        session: {
          title: "Host transcript",
          blocks: [{ id: "reply", role: "assistant", text: "Session preview reply" }],
        },
      };
    if (args.method === "tasks.start") {
      const target = tasks.find((task) => task.id === args.params.taskId)!;
      target.status = "running";
      return target;
    }
    if (args.method === "tasks.retarget") {
      const target = tasks.find((task) => task.id === args.params.taskId)!;
      Object.assign(target, {
        workspace: args.params.workspace,
        deliveryCwd: args.params.workspace?.checkoutCwd,
        baseBranch: args.params.workspace?.baseBranch ?? target.baseBranch,
        mergeError: undefined,
      });
      return target;
    }
    if (args.method === "tasks.reorder")
      return args.params.taskIds.map((id: string, position: number) => {
        const target = tasks.find((task) => task.id === id)!;
        target.position = position;
        return target;
      });
    if (args.method === "goals.list") return goals;
    if (args.method === "goals.update") {
      const target = goals.find((goal) => goal.id === args.params.goalId)!;
      Object.assign(target, args.params.settings, { updatedAt: 2 });
      return target;
    }
    if (args.method === "goals.create") {
      const created = {
        ...args.params.goal,
        status: "planning",
        taskIds: [],
        createdAt: 1,
        updatedAt: 1,
      };
      goals.push(created);
      return created;
    }
    if (args.method === "stewards.list") return stewards;
    if (args.method === "host.settings.get" && limits) return limits;
    if (args.method === "host.settings.save" && limits)
      return { ...limits, ...args.params.settings };
    if (args.method === "tasks.move") return { ...tasks[0], status: args.params.to };
    if (args.method === "tasks.review.recheck") return { ...tasks[0], status: "verifying" };
    if (args.method === "tasks.notes.read" || args.method === "tasks.notes.resolve") {
      const target = tasks.find((task) => task.id === args.params.taskId)!;
      target.reviewNotes = target.reviewNotes?.map((note) => {
        if (args.method === "tasks.notes.read" && args.params.noteIds.includes(note.id))
          return { ...note, readAt: 3 };
        if (args.method === "tasks.notes.resolve" && args.params.noteId === note.id)
          return { ...note, resolvedAt: args.params.resolved ? 3 : undefined };
        return note;
      });
      return target;
    }
    if (args.method === "tasks.delete") {
      tasks.splice(0);
      return { deleted: true };
    }
    if (args.method === "goals.approve") {
      const target = goals.find((goal) => goal.id === args.params.goalId)!;
      target.status = "running";
      return target;
    }
    if (args.method === "stewards.runNow")
      return stewards.find((steward) => steward.id === args.params.stewardId);
    if (args.method === "stewards.save") {
      const target = stewards.find((steward) => steward.id === args.params.steward.id);
      const saved = {
        ...target,
        ...args.params.steward,
        createdAt: target?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      if (target) Object.assign(target, saved);
      else stewards.push(saved);
      return saved;
    }
    return {};
  });
  return requests;
}

async function render(
  onOpenBackgroundSession = vi.fn(),
  section: "backlog" | "sprints" = "sprints",
) {
  await act(async () =>
    root.render(
      createElement(TasksView, {
        cwd: "/work/project",
        recents: [],
        onClose: vi.fn(),
        onOpenBackgroundSession,
      }),
    ),
  );
  await act(async () => {});
  if (section === "sprints") await act(async () => button(container, "Sprints")?.click());
  const goals = container.querySelector<HTMLDetailsElement>(".task-goals-disclosure");
  if (goals) goals.open = true;
}

const column = (status: string) =>
  container.querySelector<HTMLElement>(`[data-task-column="${status}"]`)!;
function buttonText(entry: HTMLButtonElement) {
  const copy = entry.cloneNode(true) as HTMLButtonElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return copy.textContent?.trim();
}
const buttonName = (entry: HTMLButtonElement) =>
  entry.getAttribute("aria-label") ?? buttonText(entry);
const button = (scope: ParentNode, label: string) =>
  Array.from(scope.querySelectorAll("button")).find(
    (entry) => buttonName(entry) === label || buttonText(entry) === label,
  );
async function allProjects() {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('header.task-board-toolbar button[aria-label^="Project:"]')!
      .click(),
  );
  await act(async () => button(document.body, "All projects")!.click());
}
async function pickAction(scope: ParentNode, label: string) {
  const direct = button(scope, label);
  if (direct) {
    await act(async () => direct.click());
    return;
  }
  await act(async () => button(scope, "More actions")!.click());
  const action = button(document.body.querySelector('[role="menu"]')!, label)!;
  expect(action, label).toBeTruthy();
  await act(async () => action.click());
}

async function promoteSession() {
  const open = button(document.body, "Open in Sessions");
  expect(open).toBeTruthy();
  await act(async () => open!.click());
}

/** Types into a controlled React field. */
function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
const card = (title: string) =>
  container.querySelector<HTMLElement>(`article[aria-label="${title}"]`)!;
const panel = () => container.querySelector<HTMLElement>('aside[aria-label="Task details"]');

beforeEach(() => {
  resetRetainedState();
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  invoke.mockReset();
  // Each test describes the same machine differently.
  invalidateMachineSnapshot();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("defers hidden board reads, resumes on focus and pauses interval requests while hidden", async () => {
  host([task({ title: "Visible board task", status: "todo" })]);
  await act(async () => focusManager.setFocused(false));
  await render();
  expect(invoke.mock.calls.filter(([command]) => command === "remote_machines")).toHaveLength(0);
  await act(async () => focusManager.setFocused(true));
  await act(async () => {});
  expect(card("Visible board task")).toBeTruthy();
  await act(async () => focusManager.setFocused(false));
  const calls = invoke.mock.calls.length;
  vi.useFakeTimers();
  try {
    await act(async () => vi.advanceTimersByTime(45_000));
    expect(invoke.mock.calls).toHaveLength(calls);
  } finally {
    vi.useRealTimers();
  }
});

it("opens task and goal creation in dialogs with workspace and start choices", async () => {
  host([], ["tasks", "tasks.todo", "goals", "tasks.workspaces"]);
  await render();
  await pickAction(container, "New goal");
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).toBeTruthy();
  expect(dialog.textContent).toContain("Working branch and worktree");
  expect(dialog.textContent).toContain("Start planned tasks");
  expect(dialog.textContent).toContain("Concurrent tasks in this goal");
  await act(async () => button(dialog, "Cancel")!.click());
  await act(async () => button(container, "New task")!.click());
  expect(document.querySelector('[role="dialog"] form[aria-label="New task"]')).toBeTruthy();
});

it("starts in the open project's backlog and creates in the explicitly selected project", async () => {
  host([
    task({ id: "a", title: "Project A work", status: "todo" }),
    task({ id: "b", projectId: "project-2", title: "Project B work", status: "todo" }),
  ]);
  const original = invoke.getMockImplementation()!;
  const saved: any[] = [];
  invoke.mockImplementation(async (command: string, args?: any) => {
    if (command === "remote_request" && args.method === "projects.list")
      return [
        { id: "project-1", cwd: "/work/project", name: "project" },
        { id: "project-2", cwd: "/work/other", name: "other" },
      ];
    if (command === "remote_request" && args.method === "tasks.save") {
      saved.push(args.params.task);
      return task(args.params.task);
    }
    return original(command, args);
  });
  await render(undefined, "backlog");
  const list = () => container.querySelector('[aria-label="Tasks"].task-management-list');
  expect(list()?.textContent).toContain("Project A work");
  expect(list()?.textContent).not.toContain("Project B work");
  await allProjects();
  expect(list()?.textContent).toContain("Project B work");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('header.task-board-toolbar button[aria-label^="Project:"]')!
      .click(),
  );
  const choice = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(
    (option) => option.textContent?.includes("other ·"),
  )!;
  await act(async () => choice.click());
  expect(list()?.textContent).not.toContain("Project A work");
  expect(list()?.textContent).toContain("Project B work");
  await act(async () => button(container, "New task")!.click());
  const form = document.querySelector('form[aria-label="New task"]')!;
  await act(async () => type(form.querySelector('input[aria-label="Task title"]')!, "New B work"));
  await act(async () => button(form, "Add to To do")!.click());
  expect(saved).toHaveLength(1);
  expect(saved[0].projectId).toBe("project-2");
});

it("starts a queued task explicitly on its own host", async () => {
  const requests = host([task({ status: "queued" })], ["tasks", "tasks.todo", "tasks.workspaces"]);
  await render();
  await act(async () => button(card("Ship the report"), "Start now")!.click());
  expect(requests).toContainEqual({ method: "tasks.start", params: { taskId: "main" } });
});

it("reorders queued cards with drag and drop and supports equivalent buttons", async () => {
  const requests = host(
    [task({ id: "one", title: "First" }), task({ id: "two", title: "Second" })],
    ["tasks", "tasks.todo", "tasks.workspaces"],
  );
  await render();
  await act(async () => button(card("Second"), "More actions")!.click());
  expect(button(document.body.querySelector('[role="menu"]')!, "Move earlier")).toBeTruthy();
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  const transfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  const dispatch = (target: HTMLElement, type: string) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    target.dispatchEvent(event);
  };
  await act(async () => dispatch(card("Second").parentElement!, "dragstart"));
  await act(async () => dispatch(column("queued"), "dragover"));
  await act(async () => dispatch(card("First").parentElement!, "drop"));
  expect(requests).toContainEqual({ method: "tasks.reorder", params: { taskIds: ["two", "one"] } });
  expect(transfer.setData).toHaveBeenCalledWith("application/x-bycoda-task", "machine-local:two");
});

it("creates and selects a delivery worktree without restarting the completed worker", async () => {
  const requests = host(
    [
      task({
        status: "review",
        branch: "mc/result",
        baseBranch: "main",
        mergeError: "uncommitted changes",
      }),
    ],
    ["tasks", "tasks.todo", "tasks.workspaces"],
  );
  await render();
  await pickAction(card("Ship the report"), "Choose delivery target");
  const dialog = document.querySelector('[role="dialog"]')!;
  await act(async () =>
    type(
      dialog.querySelector<HTMLInputElement>('input[placeholder="goal/settings"]')!,
      "goal/owner",
    ),
  );
  await act(async () => button(dialog, "Create a separate worktree")!.click());
  await act(async () => button(dialog, "Save delivery target")!.click());
  expect(requests).toContainEqual({
    method: "tasks.retarget",
    params: {
      taskId: "main",
      workspace: { checkoutCwd: "/work/new-integration", baseBranch: "goal/owner" },
      autoMerge: undefined,
    },
  });
  expect(requests.some((request) => request.method === "tasks.start")).toBe(false);
});

it("lists the goal's worker sessions and preserves their host bindings", async () => {
  const open = vi.fn();
  host(
    [task({ goalId: "launch", status: "running", sessionId: "worker" })],
    ["tasks", "tasks.todo", "goals"],
    [goal({ status: "running", taskIds: ["main"] })],
  );
  await render(open);
  await act(async () => button(card("Launch the beta"), "Task sessions")!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  await act(async () => button(dialog, "Open worker session")!.click());
  await promoteSession();
  expect(open).toHaveBeenCalledWith({
    machineId: "machine-local",
    cwd: "/work/project",
    projectId: "project-1",
    sessionId: "worker",
  });
});

it("lays tasks out in six columns with the actions each status allows", async () => {
  host([
    task({ id: "t", status: "todo" }),
    task({ id: "a" }),
    task({ id: "b", status: "running", startedAt: 1, needsInput: true }),
    task({ id: "c", status: "review", completedAt: 2 }),
    task({ id: "d", status: "done", completedAt: 2 }),
    task({ id: "e", status: "blocked", completedAt: 2, error: "Not signed in" }),
  ]);
  await render();
  expect(
    Array.from(container.querySelectorAll("[data-task-column]"), (section) =>
      section.getAttribute("aria-label"),
    ),
  ).toEqual(["To do", "Queued", "Running", "Review", "Done", "Blocked"]);
  const actions = (status: string) =>
    Array.from(column(status).querySelectorAll("button"), buttonName);
  // A card offers its lead action; everything else, Delete last, is in the menu.
  expect(actions("todo")).toEqual(["Start", "More actions"]);
  expect(actions("queued")).toEqual(["More actions"]);
  expect(actions("running")).toEqual(["Stop"]);
  expect(actions("review")).toEqual(["Approve", "More actions"]);
  expect(actions("done")).toEqual(["Run again", "More actions"]);
  expect(actions("blocked")).toEqual(["Task failed", "Retry", "More actions"]);
  await act(async () => button(column("blocked"), "More actions")!.click());
  expect(Array.from(document.body.querySelectorAll('[role="menu"] button'), buttonName)).toEqual([
    "Move to To do",
    "Edit",
    "Delete",
  ]);
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(column("running").textContent).toContain("Needs input");
  expect(column("blocked").textContent).not.toContain("Not signed in");
  await act(async () => button(column("blocked"), "Task failed")!.click());
  expect(document.body.textContent).toContain("Not signed in");
  await act(async () => button(document.body.querySelector('[role="dialog"]')!, "Close")!.click());
  expect(column("queued").textContent).toContain("on this computer");
});

it("searches goal filters in the compact popover, marks active scope and resets without writes", async () => {
  const requests = host(
    [
      task({ id: "goal-task", title: "Goal task", goalId: "launch", status: "todo" }),
      task({ id: "independent", title: "Independent task", status: "todo" }),
    ],
    ["tasks", "tasks.todo", "goals"],
    [goal({ status: "running" })],
  );
  await render();
  const trigger = button(container, "Filters")!;
  await act(async () => trigger.click());
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button[aria-label^="Show goal:"]')!.click(),
  );
  const choice = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(
    (option) => option.dataset.value !== "all",
  )!;
  await act(async () => choice.click());
  expect(card("Goal task")).toBeTruthy();
  expect(card("Independent task")).toBeNull();
  expect(trigger.getAttribute("aria-pressed")).toBe("true");
  await act(async () =>
    button(document.body.querySelector('[role="dialog"][aria-label="Filters"]')!, "Reset")!.click(),
  );
  expect(card("Independent task")).toBeTruthy();
  expect(trigger.getAttribute("aria-pressed")).toBe("false");
  expect(requests.some(({ method }) => /\.(create|update|move|delete|approve)$/.test(method))).toBe(
    false,
  );
});

it("keeps a goal filter when the task tool is reopened without retaining its open menu", async () => {
  host(
    [
      task({ id: "goal-task", title: "Goal task", goalId: "launch", status: "todo" }),
      task({ id: "independent", title: "Independent task", status: "todo" }),
    ],
    ["tasks", "tasks.todo", "goals"],
    [goal({ status: "running" })],
  );
  await render();
  await act(async () => button(container, "Filters")!.click());
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button[aria-label^="Show goal:"]')!.click(),
  );
  const choice = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(
    (option) => option.dataset.value !== "all",
  )!;
  await act(async () => choice.click());
  const scroller = column("todo").parentElement!.parentElement!;
  scroller.scrollLeft = 615;
  scroller.scrollTop = 120;
  scroller.dispatchEvent(new Event("scroll"));
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(card("Goal task")).toBeTruthy();
  expect(card("Independent task")).toBeNull();
  expect(button(container, "Filters")!.getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector('[role="dialog"][aria-label="Filters"]')).toBeNull();
  const restoredScroller = column("todo").parentElement!.parentElement!;
  expect(restoredScroller.scrollLeft).toBe(615);
  expect(restoredScroller.scrollTop).toBe(120);
});

it("shows pending and genuinely empty task board states", async () => {
  host([]);
  const original = invoke.getMockImplementation()!;
  let resolveMachines!: (machines: unknown[]) => void;
  const pendingMachines = new Promise<unknown[]>((resolve) => {
    resolveMachines = resolve;
  });
  invoke.mockImplementation((command: string, args?: any) =>
    command === "remote_machines" ? pendingMachines : original(command, args),
  );
  await render();
  expect(container.querySelector('[data-remote-data-state="loading"]')).toBeTruthy();
  await act(async () => {
    resolveMachines([]);
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {});
  expect(container.querySelector('[data-remote-data-state="empty"]')).toBeTruthy();
  expect(container.querySelectorAll("[data-task-column]")).toHaveLength(0);
  expect(container.querySelectorAll(".task-column-empty")).toHaveLength(0);
  expect(container.textContent?.match(/Nothing to do yet/g)).toHaveLength(1);
});

it("keeps last-known cards visible on a failed refresh and retries the network read", async () => {
  const requests = host([task({ id: "kept", status: "todo" })]);
  await render();
  expect(container.querySelector('[data-remote-data-state="ready"]')).toBeTruthy();
  expect(card("Ship the report")).toBeTruthy();

  const original = invoke.getMockImplementation()!;
  let failNextList = true;
  let failedListAttempts = 0;
  invoke.mockImplementation(async (command: string, args?: any) => {
    if (failNextList && command === "remote_request" && args?.method === "tasks.list") {
      failNextList = false;
      failedListAttempts++;
      throw new Error("Host timed out.");
    }
    return original(command, args);
  });
  const refreshCount = () =>
    requests.filter((entry) => entry.method === "tasks.list").length + failedListAttempts;
  const beforeFailure = refreshCount();
  await act(async () => button(container, "Refresh")!.click());
  await act(async () => {});
  expect(refreshCount()).toBe(beforeFailure + 1);
  await act(async () => button(container, "Connection issue")!.click());
  expect(document.body.textContent).toContain("Host timed out.");
  await act(async () => button(document.body.querySelector('[role="dialog"]')!, "Close")!.click());
  expect(card("Ship the report")).toBeTruthy();

  await act(async () => button(container, "Retry")!.click());
  await act(async () => {});
  expect(refreshCount()).toBe(beforeFailure + 2);
  expect(container.querySelector('[data-remote-data-state="ready"]')).toBeTruthy();
  expect(card("Ship the report")).toBeTruthy();
});

it.each(["environment.describe", "goals.list"])(
  "shows local tasks before a slow remote %s finishes",
  async (delayedMethod) => {
    host([task({ title: "Fast local task", status: "todo" })], ["tasks", "tasks.todo", "goals"]);
    const normal = invoke.getMockImplementation()!;
    let releaseRemote!: (value: unknown) => void;
    const delayed = new Promise<unknown>((resolve) => {
      releaseRemote = resolve;
    });
    const remote = {
      id: "machine-mac",
      name: "MacBook",
      endpoint: "http://mac:3774",
      environmentId: "env-mac",
    };
    const local = {
      id: "machine-local",
      name: LOCAL_SYNC_MACHINE_NAME,
      endpoint: "http://127.0.0.1:3774",
      environmentId: "env-local",
    };
    invoke.mockImplementation(async (command: string, args?: any) => {
      if (command === "remote_machines") return [remote, local];
      if (command === "remote_request" && args.machineId === remote.id) {
        if (args.method === delayedMethod) return delayed;
        if (args.method === "projects.list")
          return [{ id: "project-1", cwd: "/work/mac-project", name: "mac-project" }];
        if (args.method === "tasks.list") return [task({ title: "Remote task", status: "todo" })];
      }
      return normal(command, args);
    });
    await render();
    expect(card("Fast local task")).toBeTruthy();
    expect(container.querySelector('[data-remote-data-state="refreshing"]')).toBeTruthy();
    expect(container.querySelector('[data-remote-data-state="empty"]')).toBeNull();
    expect(invoke.mock.calls.filter(([command]) => command === "remote_machines")).toHaveLength(1);
    await act(async () => {
      releaseRemote(
        delayedMethod === "environment.describe"
          ? { capabilities: ["tasks", "tasks.todo", "goals"] }
          : [],
      );
    });
    await act(async () => {});
    expect(card("Remote task")).toBeNull();
    await allProjects();
    expect(card("Remote task")).toBeTruthy();
    expect(container.querySelector('[data-remote-data-state="ready"]')).toBeTruthy();
  },
);

it("reuses a fresh reopened board and retains last-known cards when manual refresh fails", async () => {
  host([task({ title: "Previously read task", status: "todo" })]);
  await render();
  expect(container.querySelector('[data-remote-data-state="ready"]')).toBeTruthy();
  await act(async () => root.unmount());
  root = createRoot(container);
  const normal = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command: string, args?: any) => {
    if (command === "remote_request" && args.method === "tasks.list")
      throw new Error("Host is offline.");
    return normal(command, args);
  });
  const readsBefore = invoke.mock.calls.filter(
    ([command, args]) => command === "remote_request" && args.method === "tasks.list",
  ).length;
  await render();
  expect(
    invoke.mock.calls.filter(
      ([command, args]) => command === "remote_request" && args.method === "tasks.list",
    ),
  ).toHaveLength(readsBefore);
  expect(card("Previously read task")).toBeTruthy();
  await act(async () => button(container, "Refresh")!.click());
  await act(async () => button(container, "Connection issue")!.click());
  expect(document.body.textContent).toContain("Host is offline.");
  await act(async () => button(document.body.querySelector('[role="dialog"]')!, "Close")!.click());
  expect(container.querySelector('[data-remote-data-state="ready"]')).toBeNull();
  expect(container.querySelector('[data-remote-data-state="empty"]')).toBeNull();
});

it("removes the old host's cards and write targets while a reused machine identity probes", async () => {
  host([task({ title: "Old host task", status: "todo" })]);
  await render();
  expect(card("Old host task")).toBeTruthy();
  const normal = invoke.getMockImplementation()!;
  let releaseProbe!: (value: unknown) => void;
  const probe = new Promise<unknown>((resolve) => {
    releaseProbe = resolve;
  });
  invoke.mockImplementation(async (command: string, args?: any) => {
    if (command === "remote_machines")
      return [
        {
          id: "machine-local",
          name: "Replacement remote host",
          endpoint: "http://new-host:3774",
          environmentId: "env-new",
        },
      ];
    if (command === "remote_request" && args.method === "environment.describe") return probe;
    if (command === "remote_request" && args.method === "tasks.list") return [];
    return normal(command, args);
  });
  await act(async () => button(container, "Refresh")!.click());
  await act(async () => {});
  expect(card("Old host task")).toBeNull();
  await act(async () => button(container, "New task")!.click());
  const form = document.querySelector('form[aria-label="New task"]')!;
  await act(async () =>
    type(form.querySelector<HTMLInputElement>('input[aria-label="Task title"]')!, "A new task"),
  );
  expect(button(form, "Add to To do")!.disabled).toBe(true);
  expect(button(form, "Add and start")!.disabled).toBe(true);
  await act(async () => releaseProbe({ capabilities: ["tasks", "tasks.todo"] }));
  await act(async () => {});
  expect(container.querySelector('[data-remote-data-state="ready"]')).toBeTruthy();
  expect(card("Old host task")).toBeNull();
});

it("asks the task's machine to move it", async () => {
  const requests = host([task({ status: "review", completedAt: 2 })]);
  await render();
  await act(async () => button(column("review"), "Approve")!.click());
  expect(requests).toContainEqual({
    method: "tasks.move",
    params: { taskId: "main", to: "done" },
  });
});

it("shows a task being verified under Running", async () => {
  host([task({ status: "verifying", startedAt: 1, branch: "mc/abcd1234" })]);
  await render();
  expect(container.querySelectorAll("[data-task-column]")).toHaveLength(6);
  expect(column("running").textContent).toContain("Verifying");
  expect(column("running").textContent).toContain("mc/abcd1234");
  expect(Array.from(column("running").querySelectorAll("button"), buttonName)).toEqual([
    "Review changes",
    "Stop",
  ]);
});

it("offers to merge a reviewed branch and shows what was checked", async () => {
  const requests = host([
    task({
      status: "review",
      completedAt: 2,
      branch: "mc/abcd1234",
      baseBranch: "main",
      diffStat: " report.md | 1 +\n 1 file changed, 1 insertion(+)",
      mergeError: "The project has uncommitted changes.",
      verification: {
        command: { exitCode: 0, output: "12 tests passed", timedOut: false },
        review: { verdict: "pass", note: "Covers the week.", sessionId: "s" },
      },
    }),
  ]);
  await render();
  const card = column("review");
  expect(button(card, "Approve")).toBeUndefined();
  expect(card.textContent).toContain("mc/abcd1234");
  expect(card.textContent).not.toContain("1 file changed");
  expect(card.textContent).toContain("Delivery is blocked");
  await act(async () => button(card, "Delivery is blocked")!.click());
  const details = document.body.querySelector('[role="dialog"]')!;
  expect(details.textContent).toContain("Check command passed");
  expect(details.textContent).toContain("Reviewer passed · Covers the week.");
  expect(details.querySelector("details")!.open).toBe(false);
  expect(details.querySelector("details pre")!.textContent).toBe("12 tests passed");
  expect(details.textContent).toContain("The project has uncommitted changes.");
  await act(async () => button(details, "Close")!.click());
  expect(card.textContent).toContain("Implementation finished");
  expect(card.textContent).toContain("Delivery is blocked");
  await act(async () => button(card, "Review changes")!.click());
  expect(card.textContent).toContain(
    "Update bycoda Host to review and approve this task's delivery.",
  );
  expect(requests.some((request) => request.method === "tasks.move")).toBe(false);
});

it("confirms before discarding the branch of an unmerged task", async () => {
  const requests = host([
    task({
      status: "blocked",
      completedAt: 2,
      error: "The check command failed (exit code 1).",
      branch: "mc/abcd1234",
      baseBranch: "main",
      verification: {
        command: { exitCode: 1, output: "1 failed", timedOut: false },
      },
    }),
  ]);
  await render();
  await act(async () => button(column("blocked"), "Task failed")!.click());
  expect(document.body.textContent).toContain("Check command failed (exit code 1)");
  await act(async () => button(document.body.querySelector('[role="dialog"]')!, "Close")!.click());
  await pickAction(column("blocked"), "Delete");
  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog().textContent).toContain(
    "Its work on mc/abcd1234 was never merged, and the branch will be discarded.",
  );
  await act(async () => button(dialog(), "Cancel")!.click());
  expect(requests.some((request) => request.method === "tasks.delete")).toBe(false);
  await pickAction(column("blocked"), "Delete");
  await act(async () => button(dialog(), "Delete")!.click());
  expect(requests).toContainEqual({
    method: "tasks.delete",
    params: { taskId: "main", expectedUpdatedAt: 1, discard: true },
  });
});

it("offers the branch, check and review options on a new task", async () => {
  host([]);
  await render();
  await act(async () => button(container, "New task")!.click());
  const form = document.querySelector('form[aria-label="New task"]')!;
  // The agent controls are tucked away until asked for.
  expect(form.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  expect(button(form, "Shared checkout")!.getAttribute("aria-checked")).toBe("true");
  await act(async () => button(form, "Agent settings")!.click());
  const boxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  expect(boxes.map((box) => box.parentElement!.textContent?.trim())).toEqual([
    "Review with a second agent",
    "Merge automaticallyAutomatic merge is suspended. Review changes to renew approval.",
    "Continue until completeKeeps correcting while progress is made; asks for input when needed.",
  ]);
  expect(boxes.map((box) => box.checked)).toEqual([false, false, true]);
  expect(form.querySelector<HTMLInputElement>('input[aria-label="Check command"]')!.value).toBe("");
  await act(async () => boxes[0].click());
  const reviewerProfile = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ).find((box) => box.parentElement!.textContent?.trim() === "Use a separate reviewer profile")!;
  expect(reviewerProfile.checked).toBe(false);
  await act(async () => reviewerProfile.click());
  expect(form.textContent).toContain("Reviewer instructions");
});

it.each(["local", "remote"])(
  "defaults a task in global scope to this computer and routes an explicit %s choice",
  async (destination) => {
    host([]);
    const original = invoke.getMockImplementation()!;
    const remoteCwd = "remote://env-mac/work/mac-project";
    const saves: Array<{ machineId: string; task: any }> = [];
    invoke.mockImplementation(async (command: string, args?: any) => {
      if (command === "remote_machines")
        return [
          {
            id: "machine-mac",
            name: "MacBook",
            endpoint: "http://mac:3774",
            environmentId: "env-mac",
          },
          {
            id: "machine-local",
            name: LOCAL_SYNC_MACHINE_NAME,
            endpoint: "http://127.0.0.1:3774",
            environmentId: "env-local",
          },
        ];
      if (command === "remote_request" && args.method === "projects.list")
        return [
          {
            id: args.machineId === "machine-mac" ? "mac-project" : "project-1",
            cwd: args.machineId === "machine-mac" ? "/work/mac-project" : "/work/project",
            name: "project",
          },
        ];
      if (command === "remote_request" && args.method === "tasks.save") {
        saves.push({ machineId: args.machineId, task: args.params.task });
        return task(args.params.task);
      }
      return original(command, args);
    });
    await act(async () =>
      root.render(
        createElement(TasksView, {
          cwd: remoteCwd,
          recents:
            destination === "remote"
              ? [{ path: "/work/project", openedAt: 1 }]
              : [
                  { path: remoteCwd, openedAt: 2 },
                  { path: "/work/project", openedAt: 1 },
                ],
          onClose: vi.fn(),
          onOpenBackgroundSession: vi.fn(),
        }),
      ),
    );
    await act(async () => {});
    await allProjects();
    await act(async () => button(container, "New task")!.click());
    const form = document.querySelector('form[aria-label="New task"]')!;
    expect(form.querySelector('[aria-label="Machine: This computer"]')).toBeTruthy();
    expect(form.textContent).toContain("Runs on this computer");
    if (destination === "remote") {
      await act(async () =>
        form.querySelector<HTMLButtonElement>('[aria-label="Machine: This computer"]')!.click(),
      );
      await act(async () =>
        Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))
          .find((entry) => entry.textContent?.trim() === "MacBook")!
          .click(),
      );
      expect(button(form, "Add and start")!.disabled).toBe(true);
      await act(async () =>
        form.querySelector<HTMLButtonElement>('[aria-label="Project: Choose project"]')!.click(),
      );
      expect(
        Array.from(document.querySelectorAll('[role="option"]')).map((entry) =>
          entry.textContent?.trim(),
        ),
      ).toEqual(["mac-project"]);
      await act(async () => document.querySelector<HTMLButtonElement>('[role="option"]')!.click());
      expect(form.textContent).toContain("Runs on MacBook");
    }
    await act(async () => {
      type(form.querySelector('input[aria-label="Task title"]')!, "Run here");
      type(form.querySelector("textarea")!, "Do this on the selected computer");
    });
    await act(async () => button(form, "Add and start")!.click());
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({
      machineId: destination === "remote" ? "machine-mac" : "machine-local",
      task: { projectId: destination === "remote" ? "mac-project" : "project-1", status: "queued" },
    });
  },
);

it("does not silently use a remote host in global scope when this computer is unavailable", async () => {
  host([]);
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command: string, args?: any) => {
    if (command === "remote_machines")
      return [
        {
          id: "machine-mac",
          name: "MacBook",
          endpoint: "http://mac:3774",
          environmentId: "env-mac",
        },
      ];
    return original(command, args);
  });
  await act(async () =>
    root.render(
      createElement(TasksView, {
        cwd: "remote://env-mac/work/project",
        recents: [{ path: "remote://env-mac/work/project", openedAt: 1 }],
        onClose: vi.fn(),
        onOpenBackgroundSession: vi.fn(),
      }),
    ),
  );
  await act(async () => {});
  await allProjects();
  await act(async () => button(container, "New task")!.click());
  const form = document.querySelector('form[aria-label="New task"]')!;
  expect(form.textContent).not.toContain("Runs on MacBook");
  expect(button(form, "Add and start")!.disabled).toBe(true);
  expect(button(form, "Add to To do")!.disabled).toBe(true);
});

it.each(["local", "remote"])(
  "pins a goal to an explicit %s machine from a remote workspace",
  async (destination) => {
    host([], ["tasks", "tasks.todo", "goals"]);
    const original = invoke.getMockImplementation()!;
    const creates: Array<{ machineId: string; goal: any }> = [];
    invoke.mockImplementation(async (command: string, args?: any) => {
      if (command === "remote_machines")
        return [
          {
            id: "machine-mac",
            name: "MacBook",
            endpoint: "http://mac:3774",
            environmentId: "env-mac",
          },
          {
            id: "machine-local",
            name: LOCAL_SYNC_MACHINE_NAME,
            endpoint: "http://127.0.0.1:3774",
            environmentId: "env-local",
          },
        ];
      if (command === "remote_request" && args.method === "projects.list")
        return [
          {
            id: args.machineId === "machine-mac" ? "mac-project" : "project-1",
            cwd: args.machineId === "machine-mac" ? "/work/mac-project" : "/work/project",
            name: "project",
          },
        ];
      if (command === "remote_request" && args.method === "goals.create") {
        creates.push({ machineId: args.machineId, goal: args.params.goal });
        return {
          ...args.params.goal,
          id: "created-goal",
          taskIds: [],
          status: "planning",
          createdAt: 1,
          updatedAt: 1,
        };
      }
      return original(command, args);
    });
    await act(async () =>
      root.render(
        createElement(TasksView, {
          cwd: "remote://env-mac/work/mac-project",
          recents: [{ path: "/work/project", openedAt: 1 }],
          onClose: vi.fn(),
          onOpenBackgroundSession: vi.fn(),
        }),
      ),
    );
    await act(async () => {});
    await allProjects();
    await pickAction(container, "New goal");
    const form = document.querySelector('form[aria-label="New goal"]')!;
    expect(form.querySelector('[aria-label="Machine: This computer"]')).toBeTruthy();
    if (destination === "remote") {
      await act(async () =>
        form.querySelector<HTMLButtonElement>('[aria-label="Machine: This computer"]')!.click(),
      );
      await act(async () =>
        Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))
          .find((entry) => entry.textContent?.trim() === "MacBook")!
          .click(),
      );
      expect(form.querySelectorAll("[data-goal-project]")).toHaveLength(0);
      expect(button(form, "Plan it")!.disabled).toBe(true);
      await act(async () =>
        form.querySelector<HTMLButtonElement>('[aria-label="Project: Choose project"]')!.click(),
      );
      expect(
        Array.from(document.querySelectorAll('[role="option"]')).map((entry) =>
          entry.textContent?.trim(),
        ),
      ).toEqual(["mac-project"]);
      await act(async () => document.querySelector<HTMLButtonElement>('[role="option"]')!.click());
    }
    await act(async () => {
      type(form.querySelector('input[aria-label="Goal title"]')!, "Complete here");
      type(
        form.querySelector('textarea[aria-label="Main job"]')!,
        "Work on the selected machine until finished",
      );
    });
    await act(async () => button(form, "Plan it")!.click());
    expect(creates).toEqual([
      {
        machineId: destination === "remote" ? "machine-mac" : "machine-local",
        goal: expect.objectContaining({
          projectIds: [destination === "remote" ? "mac-project" : "project-1"],
          continueUntilDone: true,
          finalReview: true,
        }),
      },
    ]);
  },
);

it("refuses to silently ignore continuous execution on an older host", async () => {
  const requests = host([]);
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command: string, args?: any) => {
    if (command === "remote_request" && args.method === "environment.describe")
      return { capabilities: ["tasks", "tasks.todo"] };
    return original(command, args);
  });
  await render();
  await act(async () => button(container, "New task")!.click());
  const form = document.querySelector('form[aria-label="New task"]')!;
  await act(async () => {
    type(form.querySelector('input[aria-label="Task title"]')!, "Keep going");
    type(form.querySelector("textarea")!, "Finish the work");
  });
  await act(async () => button(form, "Add and start")!.click());
  expect(document.body.textContent).toContain(
    "Update bycoda Host on this computer to continue tasks until complete.",
  );
  expect(requests.some((entry) => entry.method === "tasks.save")).toBe(false);
  expect(requests.some((entry) => entry.method === "projects.open")).toBe(false);
});

it("does not label a continuous runtime failure as an exhausted correction budget", async () => {
  host([
    task({
      status: "blocked",
      continueUntilDone: true,
      repairAttempts: 5,
      error: "Provider disconnected",
    }),
  ]);
  await render();
  expect(column("blocked").textContent).not.toContain("Provider disconnected");
  await act(async () => button(column("blocked"), "Task failed")!.click());
  expect(document.body.textContent).toContain("Provider disconnected");
  expect(column("blocked").textContent).not.toContain("attempt limit reached");
  expect(button(column("blocked"), "Retry")).toBeTruthy();
});

it("says so when the project's machine cannot take a task", async () => {
  host([], []);
  await render();
  expect(container.textContent).toContain("No connected machine has a task board.");
  await act(async () => button(container, "New task")!.click());
  const form = document.querySelector('form[aria-label="New task"]')!;
  expect(form.querySelector('[role="alert"]')?.textContent).toContain(
    "isn’t connected, or its bycoda Host needs an update",
  );
  expect(button(form, "Add to To do")!.disabled).toBe(true);
  expect(button(form, "Add and start")!.disabled).toBe(true);
});

it("suspends retained automatic delivery until the owner reviews changes again", async () => {
  host(
    [task({ status: "review", branch: "mc/pending", baseBranch: "main", deliveryRequested: true })],
    ["tasks", "tasks.todo", "tasks.workspaces"],
  );
  await render();
  expect(column("review").textContent).toContain(
    "Automatic merge is suspended. Review changes to renew approval.",
  );
  expect(column("review").textContent).not.toContain("Waiting for your merge approval");

  await act(async () => button(column("review"), "More actions")!.click());
  expect(
    button(document.body.querySelector('[role="menu"]')!, "Pause automatic merge"),
  ).toBeTruthy();
});

it("edits an existing goal on its own host without replanning", async () => {
  const requests = host(
    [],
    ["tasks", "goals", "goals.settings"],
    [goal({ status: "running", isolate: true, autoMerge: true })],
  );
  await render();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Edit goal settings"]')!.click(),
  );
  const form = document.querySelector<HTMLFormElement>('form[aria-label="Edit goal settings"]')!;
  expect(form.textContent).toContain(
    "Delivery requires approval of the reviewed source and target.",
  );
  await act(async () => form.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(requests).toContainEqual({
    method: "goals.update",
    params: {
      goalId: "launch",
      expectedUpdatedAt: 1,
      settings: {
        autoMerge: false,
        continueUntilDone: false,
        maxRunningTasks: 0,
        maxRunMinutes: 0,
      },
    },
  });
  expect(
    requests.some(
      (request) => request.method === "goals.create" || request.method === "goals.replan",
    ),
  ).toBe(false);
  expect(document.querySelector('form[aria-label="Edit goal settings"]')).toBeNull();
});

it("keeps goal settings and reports a failed save inline", async () => {
  host(
    [],
    ["tasks", "goals", "goals.settings"],
    [goal({ status: "running", isolate: true, autoMerge: true })],
  );
  const originalInvoke = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command, args: any) => {
    if (command === "remote_request" && args?.method === "goals.update")
      throw new Error("This goal changed. Close and reopen settings before saving.");
    return originalInvoke(command, args);
  });
  await render();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Edit goal settings"]')!.click(),
  );
  const form = document.querySelector<HTMLFormElement>('form[aria-label="Edit goal settings"]')!;
  await act(async () => form.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(form.querySelector('[role="alert"]')?.textContent).toContain("Close and reopen settings");
  expect(form.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  expect(button(form, "Save")!.disabled).toBe(false);
});

it("disables goal settings on hosts without the update capability", async () => {
  host([], ["tasks", "goals"], [goal({ status: "running" })]);
  await render();
  const edit = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Edit goal settings"]',
  )!;
  expect(edit.disabled).toBe(true);
  expect(edit.title).toBe("Update the selected host to edit goal settings.");
});

it("shows a plan waiting for approval and asks the goal's machine to approve it", async () => {
  const requests = host(
    [],
    ["tasks", "goals"],
    [
      goal({
        status: "awaiting-approval",
        plan: {
          tasks: [
            {
              key: "api",
              project: "/work/project",
              projectId: "project-1",
              title: "Add the endpoint",
              prompt: "Add it",
              dependsOn: [],
            },
            {
              key: "ui",
              project: "/work/project",
              projectId: "project-1",
              title: "Call the endpoint",
              prompt: "Call it",
              dependsOn: ["api"],
            },
          ],
        },
      }),
    ],
  );
  await render();
  const card = container.querySelector<HTMLElement>('article[aria-label="Launch the beta"]')!;
  expect(card.textContent).toContain("Plan ready");
  expect(card.querySelector('[aria-label="Plan"]')!.textContent).toContain(
    "Call the endpointin project· after Add the endpoint",
  );
  expect(Array.from(card.querySelectorAll("button"), buttonName)).toEqual([
    "Edit goal settings",
    "Approve",
    "Replan",
    "More actions",
  ]);
  await act(async () => button(card, "More actions")!.click());
  expect(button(document.body.querySelector('[role="menu"]')!, "Cancel")).toBeTruthy();
  expect(button(document.body.querySelector('[role="menu"]')!, "Delete")).toBeTruthy();
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  await act(async () => button(card, "Replan")!.click());
  const feedback = card.querySelector<HTMLTextAreaElement>('textarea[aria-label="Plan feedback"]')!;
  expect(feedback).toBeTruthy();
  await act(async () => button(card, "Approve")!.click());
  expect(requests).toContainEqual({
    method: "goals.approve",
    params: { goalId: "launch" },
  });
  expect(card.getAttribute("data-goal-status")).toBe("running");
});

it("labels a goal's tasks and says what a task waits for", async () => {
  host(
    [
      task({
        id: "a",
        title: "Add the endpoint",
        status: "review",
        goalId: "launch",
        completedAt: 2,
      }),
      task({ id: "b", title: "Call the endpoint", goalId: "launch", dependsOn: ["a"] }),
      task({ id: "c", title: "Unrelated" }),
    ],
    ["tasks", "goals"],
    [goal({ status: "running", taskIds: ["a", "b"] })],
  );
  await render();
  const card = container.querySelector<HTMLElement>('article[aria-label="Launch the beta"]')!;
  expect(card.textContent).toContain("0/2 done");
  const queued = column("queued");
  expect(queued.textContent).toContain("Waiting for: Add the endpoint");
  expect(
    Array.from(queued.querySelectorAll("[data-task-goal]"), (label) => label.textContent),
  ).toEqual(["Launch the beta"]);
});

it("defaults a new goal to direct work with final acceptance on and plan/task review off", async () => {
  host([], ["tasks", "goals"]);
  await render();
  await pickAction(container, "New goal");
  const form = document.querySelector('form[aria-label="New goal"]')!;
  const boxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  expect(boxes.map((box) => box.parentElement!.textContent?.trim())).toEqual([
    "Verify the integrated result before completing this goal",
    "Review the plan before starting",
    "Review each task with a second agent",
    "Merge automaticallyAutomatic merge is suspended. Review changes to renew approval.",
    "Continue until completeKeeps correcting while progress is made; asks for input when needed.",
  ]);
  expect(boxes.map((box) => box.checked)).toEqual([true, false, false, false, true]);
  expect(form.querySelector('[data-goal-project="/work/project"]')).toBeTruthy();
  expect(button(form, "Plan it")!.disabled).toBe(true);
});

it("applies a workflow to the typed task objective and submits its total budget", async () => {
  const requests = host([], ["tasks", "tasks.todo", "tasks.run-budget"]);
  await render();
  await act(async () => button(container, "New task")!.click());
  const form = document.querySelector('form[aria-label="New task"]')!;
  await act(async () => {
    type(form.querySelector('input[aria-label="Task title"]')!, "Repair card checkout");
    type(
      form.querySelector('textarea[aria-label="Description"]')!,
      "Fix card checkout while preserving the entered card draft",
    );
  });
  await act(async () => button(form, "Apply workflow")!.click());
  const agentMinutesLabel = Array.from(form.querySelectorAll<HTMLLabelElement>("label")).find(
    (label) => label.textContent?.trim() === "Agent minutes",
  )!;
  const agentMinutes = Array.from(form.querySelectorAll<HTMLInputElement>("input")).find(
    (input) => input.id === agentMinutesLabel.htmlFor,
  )!;
  await act(async () => type(agentMinutes, "12.5"));
  expect(requests.some((request) => request.method === "tasks.save")).toBe(false);
  await act(async () => button(form, "Add and start")!.click());
  const saved = (requests.find((request) => request.method === "tasks.save")!.params as any).task;
  expect(readTaskInstructions(saved.prompt)?.objective).toBe(
    "Fix card checkout while preserving the entered card draft",
  );
  expect(readTaskInstructions(saved.prompt)?.acceptance).toContain(
    "The reported behavior is corrected without breaking existing behavior",
  );
  expect(saved).toMatchObject({
    workflowId: "preset-bug-fix",
    workflowVersion: 1,
    review: true,
    budget: { maxAgentMinutes: 12.5 },
    status: "queued",
  });
  expect(saved).not.toHaveProperty("autoMerge");
});

it("discards a preparation display when its resource requirements change", async () => {
  const requests = host([], ["tasks", "tasks.todo", "tasks.preflight"]);
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command: string, args?: any) => {
    if (command === "remote_request" && args.method === "tasks.preflight")
      return {
        checkedAt: Date.now(),
        state: "ready",
        items: [{ key: "host", label: "Host", state: "ready", required: true }],
      };
    return original(command, args);
  });
  await render();
  await act(async () => button(container, "New task")!.click());
  const form = document.querySelector('form[aria-label="New task"]')!;
  await act(async () =>
    type(form.querySelector('textarea[aria-label="Description"]')!, "Inspect the source material"),
  );
  expect(form.textContent).toContain("Preparation not verified");
  await act(async () => button(form, "Check preparation")!.click());
  const visibleText = () => {
    const copy = form.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
    return copy.textContent;
  };
  expect(visibleText()).not.toContain("Preparation not verified");
  expect(visibleText()).toContain("Ready");
  await act(async () => button(form, "Add resource")!.click());
  expect(visibleText()).toContain("Preparation not verified");
  expect(requests.some((request) => request.method === "tasks.save")).toBe(false);
});

it("rejects a goal's required final acceptance on an older host before creating work", async () => {
  const requests = host([], ["tasks", "goals"]);
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command: string, args?: any) => {
    if (command === "remote_request" && args.method === "environment.describe")
      return {
        capabilities: ["tasks", "goals", "tasks.continue-until-done", "goals.direct-checkout"],
      };
    return original(command, args);
  });
  await render();
  await pickAction(container, "New goal");
  const form = document.querySelector('form[aria-label="New goal"]')!;
  await act(async () => {
    type(form.querySelector('input[aria-label="Goal title"]')!, "Integrate checkout");
    type(
      form.querySelector('textarea[aria-label="Main job"]')!,
      "Verify the complete checkout flow",
    );
  });
  await act(async () => button(form, "Plan it")!.click());
  expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain(
    "Update the selected host to verify the completed goal.",
  );
  expect(
    requests.some(
      (request) =>
        request.method === "goals.create" ||
        request.method === "tasks.save" ||
        request.method === "projects.register",
    ),
  ).toBe(false);
});

const edit = (scope: ParentNode) =>
  scope.querySelector<HTMLButtonElement>('button[aria-label="Edit title and description"]')!;
const escape = () =>
  act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

it("adds a to-do item with a title and description, or adds and starts it", async () => {
  const requests = host([]);
  await render();
  const open = async () => {
    await act(async () => button(container, "New task")!.click());
    const form = document.querySelector('form[aria-label="New task"]')!;
    await act(async () =>
      type(
        form.querySelector<HTMLInputElement>('input[aria-label="Task title"]')!,
        "Call the bank",
      ),
    );
    return form;
  };
  const describe = (form: Element, text: string) =>
    act(async () =>
      type(form.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]')!, text),
    );
  const saves = () => requests.filter((request) => request.method === "tasks.save");

  let form = await open();
  // Without a description it can be a to-do item but not start.
  expect(button(form, "Add to To do")!.disabled).toBe(false);
  expect(button(form, "Add and start")!.disabled).toBe(true);
  await describe(form, "About the card");
  await act(async () => button(form, "Add to To do")!.click());
  expect((saves()[0].params as any).task).toMatchObject({
    title: "Call the bank",
    prompt: "About the card",
    status: "todo",
  });

  form = await open();
  await describe(form, "Do it");
  await act(async () => button(form, "Add and start")!.click());
  expect((saves()[1].params as any).task).toMatchObject({
    title: "Call the bank",
    prompt: "Do it",
    status: "queued",
  });
});

it("asks for instructions only after the independent takeover failed", async () => {
  const requests = host(
    [
      task({
        status: "blocked",
        sessionId: "worker-session",
        blockedTakeover: {
          at: 1,
          blocker: "Acceptance missing",
          previousSessionId: "original-worker",
        },
        repairStop: {
          reason: "external",
          message: "Provide an Android device and test TalkBack reset.",
        },
        verification: {
          review: {
            verdict: "fail",
            note: "Acceptance missing",
            sessionId: "review-session",
          },
        },
        attemptHistory: [
          {
            attempt: 1,
            at: 2,
            workerSessionId: "worker-session",
            reviewerSessionId: "review-session",
            workerSummary: "Fixed reset and ran unit checks.",
            verdict: "fail",
            note: "Acceptance missing",
            findings: ["Acceptance missing"],
          },
        ],
      }),
    ],
    ["tasks", "tasks.todo", "tasks.review-recheck"],
  );
  await render();
  expect(card("Ship the report").textContent).toContain("Waiting for your instructions");
  await act(async () => card("Ship the report").click());
  const history = panel()!.querySelector('[aria-label="Attempt history"]')!;
  await act(async () =>
    history.querySelector<HTMLButtonElement>("[data-timeline-trigger]")!.click(),
  );
  expect(history.textContent).toContain("Fixed reset and ran unit checks.");
  expect(history.textContent).toContain("Review: Acceptance missing");
  expect(history.textContent).toContain("Provide an Android device");
  expect(button(panel()!, "Recheck review")).toBeUndefined();
  expect(button(panel()!, "Retry")).toBeUndefined();
  expect(button(panel()!, "Update instructions")).toBeDefined();
  expect(history.textContent).toContain("Update the task description");
  expect(requests.filter((request) => request.method === "tasks.review.recheck")).toEqual([]);
  expect(requests.some((request) => request.method === "tasks.move")).toBe(false);
});

it("shows automatic takeover for a blocked task without asking the owner to retry", async () => {
  host(
    [
      task({
        status: "blocked",
        sessionId: "worker",
        error: "Review failed: Missing evidence.",
        verification: {
          review: { verdict: "fail", note: "Missing evidence.", sessionId: "review" },
        },
      }),
    ],
    ["tasks", "tasks.blocked-takeover"],
  );
  await render();
  expect(card("Ship the report").textContent).toContain("AI takeover pending");
  expect(button(card("Ship the report"), "Retry")).toBeUndefined();
  expect(card("Ship the report").textContent).not.toContain("Needs input");
});

it("renders a structured task as a readable brief with a short card summary", async () => {
  host([
    task({
      prompt: JSON.stringify({
        schema: "bycoda.task.v1",
        objective: "Fix playback",
        deliverables: ["Retain seek position"],
        acceptance: ["Resume at 4 seconds"],
        constraints: [],
        verification: ["Run audio tests"],
      }),
    }),
  ]);
  await render();
  expect(card("Ship the report").querySelector("[data-task-description]")?.textContent).toBe(
    "Fix playback",
  );
  await act(async () => card("Ship the report").click());
  const description = panel()!.querySelector("[data-task-detail-description]")!;
  expect(description.textContent).toContain("Acceptance criteria");
  expect(description.textContent).toContain("Resume at 4 seconds");
  expect(description.textContent).not.toContain("bycoda.task.v1");
});

it("offers to update an older host instead of adding a to-do item", async () => {
  const requests = host([], ["tasks"]);
  await render();
  await act(async () => button(container, "New task")!.click());
  const form = document.querySelector('form[aria-label="New task"]')!;
  await act(async () =>
    type(form.querySelector<HTMLInputElement>('input[aria-label="Task title"]')!, "Idea"),
  );
  expect(form.querySelector('[role="status"]')!.textContent).toBe(
    "Update bycoda Host on this computer to add to-do items",
  );
  expect(button(form, "Add to To do")!.disabled).toBe(true);
  expect(requests.some((request) => request.method === "tasks.save")).toBe(false);
});

it("opens a task's details from its card, and closes them with Escape", async () => {
  host([
    task({
      status: "review",
      prompt: "Write the weekly report\nInclude the totals",
      completedAt: 2,
      branch: "mc/abcd1234",
      baseBranch: "main",
      diffStat: " report.md | 1 +",
      verification: {
        command: { exitCode: 0, output: "12 tests passed", timedOut: false },
        review: { verdict: "pass", note: "Covers the week.", sessionId: "s" },
      },
    }),
  ]);
  await render();
  expect(panel()).toBeNull();
  expect(card("Ship the report").textContent).toContain("Write the weekly report");
  await act(async () => card("Ship the report").click());
  await act(async () => {});
  const details = panel()!;
  expect(details).toBeTruthy();
  expect(details.textContent).toContain("Ship the report");
  expect(details.textContent).toContain("Include the totals");
  expect(details.textContent).toContain("Review");
  expect(details.textContent).toContain("mc/abcd1234");
  expect(details.textContent).toContain("12 tests passed");
  expect(details.textContent).toContain("Reviewer passed · Covers the week.");
  expect(details.textContent).toContain("report.md | 1 +");
  // The board stays visible beside it.
  expect(column("review")).toBeTruthy();

  await escape();
  expect(panel()).toBeNull();
  await act(async () => card("Ship the report").click());
  await act(async () =>
    panel()!.querySelector<HTMLButtonElement>('button[aria-label="Close details"]')!.click(),
  );
  expect(panel()).toBeNull();
});

it("shows new review notes and saves read/fixed states while opening the source reviewer", async () => {
  const openReview = vi.fn();
  const requests = host([
    task({
      status: "blocked",
      reviewNotes: [
        {
          id: "note-1",
          finding: "Friday is missing.",
          suggestion: "Include Friday totals.",
          kind: "finding",
          sessionId: "review-session",
          createdAt: 1,
          updatedAt: 1,
          occurrences: 1,
        },
      ],
    }),
  ]);
  await render(openReview);
  expect(card("Ship the report").querySelector("[data-task-review-notes]")!.textContent).toContain(
    "1 new review note",
  );
  expect(container.querySelector("[data-new-review-notes]")!.textContent).toContain(
    "1 new review note",
  );
  await act(async () => card("Ship the report").click());
  const notes = panel()!.querySelector('[aria-label="Review notes"]')!;
  expect(notes.textContent).toContain("Friday is missing.");
  expect(notes.textContent).toContain("Include Friday totals.");
  await act(async () => button(notes, "Open review")!.click());
  await promoteSession();
  expect(openReview).toHaveBeenCalledWith({
    machineId: "machine-local",
    cwd: "/work/project",
    projectId: "project-1",
    sessionId: "review-session",
  });
  await act(async () => button(notes, "Mark 1 as read")!.click());
  expect(requests.find((request) => request.method === "tasks.notes.read")!.params).toEqual({
    taskId: "main",
    noteIds: ["note-1"],
  });
  expect(container.querySelector("[data-new-review-notes]")).toBeNull();
  expect(card("Ship the report").querySelector("[data-task-review-notes]")!.textContent).toContain(
    "1 review note",
  );
  await act(async () => button(notes, "Mark fixed")!.click());
  expect(notes.textContent).toContain("0 open");
  expect(
    card("Ship the report").closest("[data-task-column]")!.getAttribute("data-task-column"),
  ).toBe("blocked");
  await act(async () => button(notes, "Reopen note")!.click());
  expect(notes.textContent).toContain("1 open");
  expect(
    requests
      .filter((request) => request.method === "tasks.notes.resolve")
      .map((request) => request.params),
  ).toEqual([
    { taskId: "main", noteId: "note-1", resolved: true },
    { taskId: "main", noteId: "note-1", resolved: false },
  ]);
});

it("opens the current worker and active reviewer from the task card and details", async () => {
  const openSession = vi.fn();
  host([
    task({
      status: "verifying",
      sessionId: "worker-current",
      worktreeCwd: "/work/isolated-task",
      reviewer: { sessionId: "review-current", startedAt: 1 },
      verification: {
        review: { sessionId: "review-previous", verdict: "fail", note: "Earlier review" },
      },
    }),
  ]);
  await render(openSession);
  const taskCard = card("Ship the report");
  await pickAction(taskCard, "Open worker session");
  await promoteSession();
  await pickAction(taskCard, "Open review session");
  await promoteSession();
  expect(panel()).toBeNull();
  expect(openSession.mock.calls.map(([target]) => target)).toEqual([
    {
      machineId: "machine-local",
      cwd: "/work/project",
      projectId: "project-1",
      sessionId: "worker-current",
    },
    {
      machineId: "machine-local",
      cwd: "/work/project",
      projectId: "project-1",
      sessionId: "review-current",
    },
  ]);
  await act(async () => taskCard.click());
  await act(async () => button(panel()!, "Open review session")!.click());
  await promoteSession();
  expect(openSession).toHaveBeenLastCalledWith({
    machineId: "machine-local",
    cwd: "/work/project",
    projectId: "project-1",
    sessionId: "review-current",
  });
});

it("retained worker and reviewer links are usable while attempt summaries stay collapsed", async () => {
  const openSession = vi.fn();
  host([
    task({
      status: "done",
      attemptHistory: [
        {
          attempt: 1,
          at: 1,
          workerSessionId: "worker-retained",
          reviewerSessionId: "review-retained",
          workerSummary: "Completed work",
          verdict: "pass",
          note: "Verified",
          findings: [],
        },
      ],
    }),
  ]);
  await render(openSession);
  await act(async () => button(card("Ship the report"), "More actions")!.click());
  const sessionMenu = document.body.querySelector('[role="menu"]')!;
  expect(button(sessionMenu, "Open worker session")).toBeTruthy();
  expect(button(sessionMenu, "Open review session")).toBeTruthy();
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  await act(async () => card("Ship the report").click());
  const history = panel()!.querySelector('[aria-label="Attempt history"]')!;
  expect(history.querySelector("[data-timeline-trigger]")!.getAttribute("aria-expanded")).toBe(
    "false",
  );
  const workerLink = button(history, "Open worker session")!;
  const reviewLink = button(history, "Open review session")!;
  expect(workerLink.closest("[data-timeline-trigger]")).toBeNull();
  expect(reviewLink.closest("[data-timeline-trigger]")).toBeNull();
  await act(async () => workerLink.click());
  await promoteSession();
  await act(async () => reviewLink.click());
  await promoteSession();
  expect(openSession.mock.calls.map(([target]) => target.sessionId)).toEqual([
    "worker-retained",
    "review-retained",
  ]);
});

it("shows a navigation failure without mutating the task", async () => {
  const requests = host([task({ status: "running", sessionId: "worker-unavailable" })]);
  await render(vi.fn().mockRejectedValue(new Error("This session is no longer available.")));
  await pickAction(card("Ship the report"), "Open worker session");
  await promoteSession();
  expect(document.body.textContent).toContain("This session is no longer available.");
  expect(
    requests.some((request) => request.method === "tasks.move" || request.method === "tasks.save"),
  ).toBe(false);
});

it("previews sessions without navigating and prevents duplicate promotion", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const open = vi.fn(() => pending);
  const requests = host([task({ status: "running", sessionId: "worker-loading" })]);
  await render(open);
  await pickAction(card("Ship the report"), "Open worker session");
  expect(open).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Session preview reply");
  expect(requests.filter((request) => request.method === "sessions.get")).toHaveLength(1);
  const promote = button(document.body, "Open in Sessions")!;
  await act(async () => {
    promote.click();
    promote.click();
  });
  expect(open).toHaveBeenCalledTimes(1);
  expect(promote.getAttribute("aria-busy")).toBe("true");
  await act(async () => finish());
  expect(button(document.body, "Open in Sessions")).toBeUndefined();
});

it("does not open the panel from a card's action buttons", async () => {
  const requests = host([task({ status: "review", completedAt: 2 })]);
  await render();
  await act(async () => button(card("Ship the report"), "Approve")!.click());
  expect(panel()).toBeNull();
  expect(requests.some((request) => request.method === "tasks.move")).toBe(true);
});

it("edits a task's title and description in the panel", async () => {
  const requests = host([task({ status: "todo" })]);
  await render();
  await act(async () => card("Ship the report").click());
  await act(async () => edit(panel()!).click());
  const form = panel()!.querySelector('form[aria-label="Edit details"]')!;
  await act(async () =>
    type(form.querySelector<HTMLInputElement>('input[aria-label="Title"]')!, "Renamed"),
  );
  await act(async () =>
    type(
      form.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]')!,
      "New details",
    ),
  );
  await act(async () => button(form, "Save")!.click());
  const save = requests.find((request) => request.method === "tasks.save")!;
  expect((save.params as any).task).toMatchObject({
    id: "main",
    title: "Renamed",
    prompt: "New details",
    model: "claude:test",
  });
  // An edit keeps the task's status.
  expect((save.params as any).task.status).toBeUndefined();
  expect(panel()!.querySelector('form[aria-label="Edit details"]')).toBeNull();
});

it("cancels an edit with Escape before closing the panel", async () => {
  host([task({ status: "todo" })]);
  await render();
  await act(async () => card("Ship the report").click());
  await act(async () => edit(panel()!).click());
  await escape();
  expect(panel()).toBeTruthy();
  expect(panel()!.querySelector('form[aria-label="Edit details"]')).toBeNull();
  await escape();
  expect(panel()).toBeNull();
});

it("gives the panel the card's actions, and closes it when the task is gone", async () => {
  const requests = host([task({ status: "todo" })]);
  await render();
  await act(async () => card("Ship the report").click());
  expect(Array.from(panel()!.querySelectorAll("button"), buttonName)).toEqual(
    expect.arrayContaining(["Mark done", "Start", "Edit", "Delete"]),
  );
  await act(async () => button(panel()!, "Start")!.click());
  expect(requests).toContainEqual({
    method: "tasks.move",
    params: { taskId: "main", to: "queued" },
  });
  await act(async () => button(panel()!, "Mark done")!.click());
  expect(requests).toContainEqual({
    method: "tasks.move",
    params: { taskId: "main", to: "done" },
  });
  await pickAction(panel()!, "Delete");
  await act(async () => button(document.body.querySelector('[role="dialog"]')!, "Delete")!.click());
  await act(async () => {});
  expect(panel()).toBeNull();
});

it("will not start a to-do item without a description", async () => {
  const requests = host([task({ status: "todo", prompt: "" })]);
  await render();
  await act(async () => card("Ship the report").click());
  await act(async () => button(panel()!, "Start")!.click());
  await act(async () => button(container, "Task action failed")!.click());
  expect(document.body.textContent).toContain(
    "Add a description before starting this task with an agent.",
  );
  expect(requests.some((request) => request.method === "tasks.move")).toBe(false);
});

const steward = (overrides: Partial<HostSteward> = {}): HostSteward => ({
  id: "steward-1",
  projectId: "project-1",
  enabled: true,
  harness: "claude",
  model: "claude:test",
  modelSettings: {},
  runtimeMode: "auto",
  scheduleKind: "daily",
  minute: 0,
  time: "09:00",
  dayOfWeek: 1,
  focus: "find bugs",
  maxProposals: 5,
  maxOpen: 10,
  autoStart: false,
  nextRunAt: new Date("2030-01-02T09:00:00").getTime(),
  declined: [],
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const CAPABILITIES = ["tasks", "tasks.todo", "stewards"];
const stewardCard = () =>
  container.querySelector<HTMLElement>('article[aria-label="Steward for project"]')!;

it("lists stewards in a panel with their schedule and last run", async () => {
  const requests = host(
    [],
    CAPABILITIES,
    [],
    [
      steward({
        lastRunAt: Date.now() - 5 * 60_000,
        lastRunStatus: "failed",
        lastRunError: "The steward’s reply has no json block.",
      }),
    ],
  );
  await render();
  // Hidden until asked for.
  expect(stewardCard()).toBeNull();
  await pickAction(container, "Stewards");
  const card = stewardCard();
  expect(card.textContent).toContain("on this computer");
  expect(card.textContent).toContain("Daily at");
  expect(card.textContent).toContain("Last run: Failed 5m ago");
  expect(card.textContent).toContain("The steward’s reply has no json block.");
  expect(card.textContent).toContain("Next run");
  expect(Array.from(card.querySelectorAll("button"), buttonName)).toEqual([
    "Enabled",
    "Run now",
    "Edit",
    "More actions",
  ]);
  await act(async () => button(card, "More actions")!.click());
  expect(button(document.body.querySelector('[role="menu"]')!, "Delete")).toBeTruthy();
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );

  await act(async () => button(card, "Run now")!.click());
  expect(requests).toContainEqual({
    method: "stewards.runNow",
    params: { stewardId: "steward-1" },
  });
  await act(async () =>
    card.querySelector<HTMLButtonElement>('button[aria-label="Enabled"]')!.click(),
  );
  const saved = requests.find((request) => request.method === "stewards.save")!;
  expect(saved.params).toMatchObject({
    steward: { id: "steward-1", projectId: "project-1", enabled: false },
  });
});

it("has no Stewards button on a machine without stewards", async () => {
  host([], ["tasks", "tasks.todo"]);
  await render();
  await act(async () => button(container, "More actions")!.click());
  expect(button(document.querySelector('[role="menu"]')!, "Stewards")).toBeUndefined();
});

it("opens a steward form with auto-start off and warns when it is turned on", async () => {
  host([], CAPABILITIES);
  await render();
  await pickAction(container, "Stewards");
  await act(async () => button(container, "Add steward")!.click());
  const form = document.querySelector('form[aria-label="New steward"]')!;
  const auto = form.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(auto.parentElement!.textContent).toContain("Start suggestions automatically");
  expect(auto.checked).toBe(false);
  expect(form.querySelector('[role="status"]')).toBeNull();
  await act(async () => auto.click());
  expect(form.querySelector('[role="status"]')!.textContent).toContain(
    "without you reviewing the idea",
  );
  expect(form.querySelector('textarea[aria-label="Focus"]')).toBeTruthy();
});

it("marks a steward's suggestion and declines it instead of deleting it", async () => {
  const requests = host(
    [
      task({
        id: "idea",
        title: "Add retry tests",
        status: "todo",
        source: "steward",
        stewardId: "steward-1",
      }),
      task({ id: "mine", title: "Mine", status: "todo" }),
    ],
    CAPABILITIES,
  );
  await render();
  const suggested = card("Add retry tests");
  expect(suggested.querySelector("[data-task-suggested]")!.textContent).toBe("Suggested");
  expect(card("Mine").querySelector("[data-task-suggested]")).toBeNull();
  expect(Array.from(suggested.querySelectorAll("button"), buttonName)).toEqual([
    "Start",
    "More actions",
  ]);

  // The detail panel carries the badge and the same action.
  await act(async () => suggested.click());
  expect(panel()!.querySelector("[data-task-suggested]")).toBeTruthy();
  expect(button(document.body, "Decline")).toBeTruthy();
  expect(button(panel()!, "Delete")).toBeUndefined();

  await act(async () => button(document.body, "Decline")!.click());
  expect(requests).toContainEqual({
    method: "stewards.decline",
    params: { taskId: "idea" },
  });
  expect(requests.some((request) => request.method === "tasks.delete")).toBe(false);
});

const LIMITS: HostSettingsState = {
  maxRunningTasks: 2,
  dailyAgentMinutes: 120,
  usedMinutes: 75,
  limitReached: false,
};
const LIMIT_CAPABILITIES = ["tasks", "tasks.todo", "host.settings"];

it("does not enable automatic delivery from a new task preference", async () => {
  const requests = host([]);
  await render();
  await act(async () => button(container, "New task")!.click());
  const form = document.querySelector('form[aria-label="New task"]')!;
  await act(async () =>
    type(form.querySelector<HTMLInputElement>('input[aria-label="Task title"]')!, "Ship it"),
  );
  await act(async () =>
    type(form.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]')!, "Do it"),
  );
  await act(async () => button(form, "Agent settings")!.click());
  const boxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  const branch = button(form, "Separate worktree")!;
  const shared = button(form, "Shared checkout")!;
  const [, merge] = boxes;
  expect(merge.disabled).toBe(true);
  await act(async () => branch.click());
  expect(merge.disabled).toBe(true);
  await act(async () => merge.click());
  expect(merge.checked).toBe(false);
  // Without its own branch there is nothing to merge on its own.
  await act(async () => shared.click());
  expect(merge.disabled).toBe(true);
  expect(merge.checked).toBe(false);
  await act(async () => branch.click());
  expect(merge.checked).toBe(false);
  await act(async () => button(form, "Add and start")!.click());
  const saved = requests.find((request) => request.method === "tasks.save")!;
  expect((saved.params as any).task).toMatchObject({
    isolate: true,
  });
  expect((saved.params as any).task.autoMerge).not.toBe(true);
});

it("sends direct goal execution and disables merge for the selected checkout", async () => {
  const requests = host([], ["tasks", "goals", "goals.direct-checkout"]);
  await render();
  await pickAction(container, "New goal");
  const form = document.querySelector('form[aria-label="New goal"]')!;
  expect(button(form, "Shared checkout")!.getAttribute("aria-checked")).toBe("true");
  expect(form.textContent).toContain("Tasks work directly in the selected checkout");
  const merge = Array.from(form.querySelectorAll("label"))
    .find((label) => label.textContent?.trim().startsWith("Merge automatically"))
    ?.querySelector<HTMLInputElement>("input");
  expect(merge?.disabled).toBe(true);
  await act(async () =>
    type(form.querySelector<HTMLInputElement>('input[aria-label="Goal title"]')!, "Direct"),
  );
  await act(async () =>
    type(form.querySelector<HTMLTextAreaElement>('textarea[aria-label="Main job"]')!, "Work here"),
  );
  await act(async () => button(form, "Plan it")!.click());
  const created = requests.find((request) => request.method === "goals.create")!;
  expect((created.params as any).goal.isolate).toBe(false);
  expect((created.params as any).goal.autoMerge).toBeUndefined();
});

it("does not enable automatic delivery from goal or steward preferences", async () => {
  const requests = host([], ["tasks", "goals", "stewards"]);
  await render();
  await pickAction(container, "New goal");
  const goalForm = document.querySelector('form[aria-label="New goal"]')!;
  const goalBoxes = Array.from(
    goalForm.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  );
  await act(async () => button(goalForm, "Separate worktree")!.click());
  const merge = goalBoxes.find((box) =>
    box.parentElement!.textContent?.trim().startsWith("Merge automatically"),
  )!;
  expect(merge.disabled).toBe(true);
  await act(async () => merge.click());
  await act(async () =>
    type(goalForm.querySelector<HTMLInputElement>('input[aria-label="Goal title"]')!, "Launch"),
  );
  await act(async () =>
    type(
      goalForm.querySelector<HTMLTextAreaElement>('textarea[aria-label="Main job"]')!,
      "Ship it",
    ),
  );
  await act(async () => button(goalForm, "Plan it")!.click());
  const created = requests.find((request) => request.method === "goals.create")!;
  expect((created.params as any).goal.autoMerge).not.toBe(true);

  await pickAction(container, "Stewards");
  await act(async () => button(container, "Add steward")!.click());
  const stewardForm = document.querySelector('form[aria-label="New steward"]')!;
  const boxes = Array.from(
    stewardForm.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  );
  const box = boxes.find((entry) =>
    entry.parentElement!.textContent!.startsWith("Merge automatically"),
  )!;
  expect(box.checked).toBe(false);
  await act(async () => box.click());
  expect(box.checked).toBe(false);
  expect(box.disabled).toBe(true);
});

it("marks a task the host merged on its own, on its card and in its details", async () => {
  host([
    task({
      status: "done",
      completedAt: 2,
      branch: "mc/abcd1234",
      baseBranch: "main",
      merged: true,
      autoMerged: true,
      mergedAt: Date.now(),
    }),
    task({ id: "manual", title: "By hand", status: "done", completedAt: 2 }),
  ]);
  await render();
  expect(card("Ship the report").querySelector("[data-task-auto-merged]")!.textContent).toBe(
    "Merged automatically",
  );
  expect(card("By hand").querySelector("[data-task-auto-merged]")).toBeNull();
  await act(async () => card("Ship the report").click());
  expect(panel()!.textContent).toContain("Merged automatically");
});

it("lists each machine's limits, shows today's use and saves a change", async () => {
  const requests = host([], LIMIT_CAPABILITIES, [], [], LIMITS);
  await render();
  expect(container.querySelector('[aria-label="Work limits"]')).toBeNull();
  await pickAction(container, "Limits");
  const panelOfLimits = container.querySelector<HTMLElement>('[aria-label="Work limits"]')!;
  expect(panelOfLimits.textContent).toContain("this computer");
  expect(panelOfLimits.textContent).toContain("Used today: 1h 15m");
  expect(panelOfLimits.textContent).toContain("Max concurrent tasks");
  expect(panelOfLimits.textContent).toContain("Daily agent time");
  const pick = (label: string) =>
    panelOfLimits.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  expect(pick("Max concurrent tasks on this computer: 2")).toBeTruthy();
  expect(pick("Daily agent time on this computer: 2 hours")).toBeTruthy();

  await act(async () => pick("Max concurrent tasks on this computer: 2").click());
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (entry) => entry.textContent?.trim() === "4",
  )!;
  await act(async () => option.click());
  expect(requests).toContainEqual({
    method: "host.settings.save",
    params: { settings: { maxRunningTasks: 4 } },
  });
  expect(pick("Max concurrent tasks on this computer: 4")).toBeTruthy();
});

it("saves custom daily hours above the presets and 24 hours", async () => {
  const requests = host([], LIMIT_CAPABILITIES, [], [], LIMITS);
  await render();
  await pickAction(container, "Limits");
  const form = container.querySelector<HTMLFormElement>(
    'form[aria-label="Custom daily agent time on this computer"]',
  )!;
  const hours = form.querySelector<HTMLInputElement>('input[type="number"]')!;
  expect(hours.value).toBe("2");
  for (const value of ["18", "48", "12.5", "0"]) {
    await act(async () => type(hours, value));
    await act(async () => button(form, "Save")!.click());
    expect(requests).toContainEqual({
      method: "host.settings.save",
      params: { settings: { dailyAgentMinutes: Number(value) * 60 } },
    });
    expect(hours.value).toBe(value);
  }
  for (const value of ["", "-1"]) {
    await act(async () => type(hours, value));
    expect(button(form, "Save")!.disabled).toBe(true);
  }
});

it.each([
  {
    action: "New task",
    form: "New task",
    title: "Task title",
    body: "Description",
    submit: "Add and start",
    method: "tasks.save",
  },
  {
    action: "New goal",
    form: "New goal",
    title: "Goal title",
    body: "Main job",
    submit: "Plan it",
    method: "goals.create",
  },
  {
    action: "Stewards",
    form: "New steward",
    title: undefined,
    body: "Focus",
    submit: "Save",
    method: "stewards.save",
  },
])(
  "locks $form drafts and cancel while the submitted snapshot is pending",
  async ({ action, form: label, title, body, submit, method }) => {
    host([], ["tasks", "tasks.todo", "goals", "stewards"]);
    const original = invoke.getMockImplementation()!;
    let rejectSave!: (error: Error) => void;
    const pending = new Promise((_, reject) => {
      rejectSave = reject;
    });
    invoke.mockImplementation(async (command: string, args?: any) => {
      if (command === "remote_request" && args.method === method) return pending;
      return original(command, args);
    });
    await render();
    await pickAction(container, action);
    if (action === "Stewards") await act(async () => button(container, "Add steward")!.click());
    const form = document.querySelector<HTMLFormElement>(`form[aria-label="${label}"]`)!;
    if (title)
      await act(async () =>
        type(
          form.querySelector<HTMLInputElement>(`input[aria-label="${title}"]`)!,
          "Submitted title",
        ),
      );
    const description = form.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${body}"]`)!;
    await act(async () => type(description, "Submitted instructions"));
    const submitting = button(form, submit)!;
    submitting.focus();
    await act(async () => submitting.click());
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect(submitting.getAttribute("aria-busy")).toBe("true");
    expect(submitting.getAttribute("aria-disabled")).toBe("true");
    expect(submitting.closest("fieldset[inert]")).toBeNull();
    expect(document.activeElement).toBe(submitting);
    if (label === "New task")
      expect(button(form, "Add to To do")!.getAttribute("aria-busy")).not.toBe("true");
    await act(async () => submitting.click());
    expect(
      invoke.mock.calls.filter(
        ([command, args]) => command === "remote_request" && (args as any)?.method === method,
      ),
    ).toHaveLength(1);
    const lock = form.querySelector<HTMLFieldSetElement>("fieldset")!;
    expect(lock.disabled).toBe(true);
    expect(lock.hasAttribute("inert")).toBe(true);
    // Synthetic events also cover callbacks from already-open portaled controls.
    await act(async () => type(description, "Later edit"));
    await act(async () => button(form, "Cancel")!.click());
    expect(form.isConnected).toBe(true);
    await act(async () => rejectSave(new Error("Save failed")));
    expect(form.isConnected).toBe(true);
    expect(description.value).toBe("Submitted instructions");
    expect(lock.disabled).toBe(false);
    await act(async () => type(description, "Retry instructions"));
    expect(description.value).toBe("Retry instructions");
  },
);

it("locks custom daily hours until the settings request settles", async () => {
  host([], LIMIT_CAPABILITIES, [], [], LIMITS);
  const original = invoke.getMockImplementation()!;
  let release!: (value: HostSettingsState) => void;
  const pending = new Promise<HostSettingsState>((resolve) => {
    release = resolve;
  });
  invoke.mockImplementation(async (command: string, args?: any) => {
    if (command === "remote_request" && args.method === "host.settings.save") return pending;
    return original(command, args);
  });
  await render();
  await pickAction(container, "Limits");
  const form = container.querySelector<HTMLFormElement>(
    'form[aria-label="Custom daily agent time on this computer"]',
  )!;
  const hours = form.querySelector<HTMLInputElement>('input[type="number"]')!;
  await act(async () => type(hours, "3"));
  await act(async () => button(form, "Save")!.click());
  expect(hours.disabled).toBe(true);
  expect(button(form, "Save")!.getAttribute("aria-disabled")).toBe("true");
  expect(button(form, "Save")!.getAttribute("aria-busy")).toBe("true");
  await act(async () => type(hours, "4"));
  await act(async () => release({ ...LIMITS, dailyAgentMinutes: 180 }));
  expect(hours.value).toBe("3");
  expect(hours.disabled).toBe(false);
});

it("locks task detail edits and cancellation while saving", async () => {
  host([task({ status: "todo" })]);
  const original = invoke.getMockImplementation()!;
  let rejectSave!: (error: Error) => void;
  const pending = new Promise((_, reject) => {
    rejectSave = reject;
  });
  invoke.mockImplementation(async (command: string, args?: any) => {
    if (command === "remote_request" && args.method === "tasks.save") return pending;
    return original(command, args);
  });
  await render();
  await act(async () => card("Ship the report").click());
  await act(async () => edit(panel()!).click());
  const form = panel()!.querySelector('form[aria-label="Edit details"]')!;
  const title = form.querySelector<HTMLInputElement>('input[aria-label="Title"]')!;
  await act(async () => type(title, "Submitted title"));
  await act(async () => button(form, "Save")!.click());
  expect(title.disabled).toBe(true);
  expect(form.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
  expect(button(form, "Cancel")!.disabled).toBe(true);
  await act(async () => type(title, "Later title"));
  await escape();
  expect(form.isConnected).toBe(true);
  await act(async () => rejectSave(new Error("Save failed")));
  expect(title.value).toBe("Submitted title");
  expect(title.disabled).toBe(false);
});

it("keeps a successfully saved task's identity when its separate start fails", async () => {
  const savedTasks: HostTask[] = [];
  host(savedTasks, ["tasks", "tasks.todo", "tasks.workspaces"]);
  const original = invoke.getMockImplementation()!;
  const savedIds: string[] = [];
  const startedIds: string[] = [];
  invoke.mockImplementation(async (command: string, args?: any) => {
    if (command === "remote_request" && args.method === "tasks.save") {
      const saved = { ...args.params.task, createdAt: 1, updatedAt: 1 } as HostTask;
      savedTasks.push(saved);
      savedIds.push(saved.id);
      return saved;
    }
    if (command === "remote_request" && args.method === "tasks.start") {
      startedIds.push(args.params.taskId);
      if (startedIds.length === 1) throw new Error("Start transport failed");
    }
    return original(command, args);
  });
  await render();
  await act(async () => button(container, "New task")!.click());
  const form = document.querySelector<HTMLFormElement>('form[aria-label="New task"]')!;
  await act(async () =>
    type(form.querySelector<HTMLInputElement>('input[aria-label="Task title"]')!, "One saved task"),
  );
  await act(async () =>
    type(
      form.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]')!,
      "Run this once",
    ),
  );
  await act(async () => button(form, "Add and start")!.click());
  expect(startedIds).toEqual(savedIds);
  expect(form.isConnected).toBe(false);
  expect(container.textContent).toContain("Task action failed");
  const existing = card("One saved task");
  expect(existing).toBeTruthy();
  await act(async () => button(existing, "Start now")!.click());
  expect(savedIds).toHaveLength(1);
  expect(startedIds).toEqual([savedIds[0], savedIds[0]]);
  expect(savedTasks).toHaveLength(1);
  expect(savedTasks[0].status).toBe("running");
});

it("disables unrelated task, goal, steward and note mutations while a board action is pending", async () => {
  host(
    [
      task({ id: "a", title: "Running A", status: "running" }),
      task({
        id: "b",
        title: "Running B",
        status: "running",
        reviewNotes: [
          {
            id: "note",
            finding: "Review this",
            kind: "finding",
            sessionId: "review",
            createdAt: 1,
            updatedAt: 1,
            occurrences: 1,
          },
        ],
      }),
    ],
    ["tasks", "tasks.todo", "goals", "stewards"],
    [goal({ status: "awaiting-approval" })],
    [steward()],
  );
  const original = invoke.getMockImplementation()!;
  let release!: (value: HostTask) => void;
  const pending = new Promise<HostTask>((resolve) => {
    release = resolve;
  });
  const stops: string[] = [];
  invoke.mockImplementation(async (command: string, args?: any) => {
    if (command === "remote_request" && args.method === "tasks.move") {
      stops.push(args.params.taskId);
      if (args.params.taskId === "a") return pending;
    }
    return original(command, args);
  });
  await render();
  await pickAction(container, "Stewards");
  await act(async () => button(card("Running A"), "Stop")!.click());
  expect(stops).toEqual(["a"]);
  await act(async () => card("Running B").click());
  expect(button(panel()!, "Stop")!.getAttribute("aria-disabled")).toBe("true");
  expect(button(card("Running B"), "Stop")!.getAttribute("aria-disabled")).toBe("true");
  const notes = panel()!.querySelector('[aria-label="Review notes"]')!;
  expect(button(notes, "Mark 1 as read")!.disabled).toBe(true);
  expect(button(notes, "Mark fixed")!.disabled).toBe(true);
  const goalCard = container.querySelector('article[aria-label="Launch the beta"]')!;
  expect(button(goalCard, "Approve")!.disabled).toBe(true);
  const stewardRow = stewardCard()!;
  expect(button(stewardRow, "Run now")!.disabled).toBe(true);
  expect(
    stewardRow.querySelector<HTMLButtonElement>('button[aria-label="Enabled"]')!.disabled,
  ).toBe(true);
  await act(async () => button(panel()!, "Stop")!.click());
  expect(stops).toEqual(["a"]);
  await act(async () => release(task({ id: "a", title: "Running A", status: "blocked" })));
  expect(button(panel()!, "Stop")!.getAttribute("aria-disabled")).not.toBe("true");
  await act(async () => button(panel()!, "Stop")!.click());
  expect(stops).toEqual(["a", "b"]);
});

it("has no Limits button on a host without work limits", async () => {
  host([], ["tasks", "tasks.todo"]);
  await render();
  await act(async () => button(container, "More actions")!.click());
  expect(button(document.querySelector('[role="menu"]')!, "Limits")).toBeUndefined();
});

it("says when a machine's daily agent time is used up", async () => {
  host([], LIMIT_CAPABILITIES, [], [], { ...LIMITS, limitReached: true });
  await render();
  expect(container.querySelector('[role="status"]')!.textContent).toBe(
    "Daily agent time on this computer is used up; queued work resumes tomorrow.",
  );
});

it("shows no daily notice while time is left", async () => {
  host([], LIMIT_CAPABILITIES, [], [], LIMITS);
  await render();
  expect(container.textContent).not.toContain("is used up");
});

const storedSummary = (title: string): DailySummary => ({
  since: 1,
  until: 2,
  finished: [
    {
      key: "machine-local:main",
      machineName: "this computer",
      project: "project",
      title,
    },
  ],
  autoMerged: 1,
  blocked: [],
  waiting: [],
  suggestions: [],
  goals: [],
  goalsFinished: [],
  usage: [],
  unreachable: ["MacBook"],
  outdated: [],
});

it("opens the last daily summary from the Summary button", async () => {
  host([task({ status: "done", completedAt: 2, title: "Ship the report" })]);
  saveStoredDailySummary(storedSummary("Ship the report"));
  await render();
  expect(container.querySelector('[aria-label="Summary"]')).toBeNull();
  await pickAction(container, "Summary");
  const summary = container.querySelector<HTMLElement>('[aria-label="Summary"]')!;
  expect(summary.textContent).toContain("Finished · 1 (1 merged automatically)");
  expect(summary.textContent).toContain("Ship the report");
  expect(summary.textContent).toContain("MacBook (not reachable)");
});

it("shows the task's details when its title in the summary is clicked", async () => {
  host([task({ status: "done", completedAt: 2, title: "Ship the report" })]);
  saveStoredDailySummary(storedSummary("Ship the report"));
  await render();
  await pickAction(container, "Summary");
  expect(panel()).toBeNull();
  const summary = container.querySelector<HTMLElement>('[aria-label="Summary"]')!;
  await act(async () => button(summary, "Ship the report")!.click());
  expect(panel()!.textContent).toContain("Ship the report");
});

it("builds a fresh summary of the last day on Refresh now, leaving the stored one", async () => {
  const now = Date.now();
  host([
    task({
      id: "new",
      title: "Fresh work",
      status: "done",
      createdAt: now - 5000,
      updatedAt: now - 1000,
      completedAt: now - 1000,
    }),
  ]);
  saveStoredDailySummary(storedSummary("Old work"));
  await render();
  await pickAction(container, "Summary");
  const summary = () => container.querySelector<HTMLElement>('[aria-label="Summary"]')!;
  expect(summary().textContent).toContain("Old work");
  await act(async () => button(summary(), "Refresh now")!.click());
  await act(async () => {});
  expect(summary().textContent).toContain("Fresh work");
  expect(summary().textContent).not.toContain("Old work");
  expect(loadStoredDailySummary()!.finished[0].title).toBe("Old work");
});

it("opens the summary panel when a notification click asked for it", async () => {
  host([]);
  requestSummaryPanel();
  await render();
  expect(container.querySelector('[aria-label="Summary"]')).not.toBeNull();
});

it("reconnects discovery on Retry and shows a probe failure only once", async () => {
  host([task({ title: "Recovered task" })]);
  const normal = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command: string, args?: any) => {
    if (command === "remote_request" && args.method === "environment.describe" && !args.fresh)
      throw new Error("Host connection refused");
    return normal(command, args);
  });
  await render();
  await act(async () => button(container, "Connection issue")!.click());
  expect(document.body.textContent?.match(/this computer: Host connection refused/g)).toHaveLength(
    1,
  );
  await act(async () => button(document.body.querySelector('[role="dialog"]')!, "Close")!.click());
  expect(container.textContent).not.toContain("Recovered task");
  await act(async () => button(container, "Retry")!.click());
  await act(async () => {});
  expect(container.textContent).toContain("Recovered task");
  expect(container.textContent).not.toContain("Host connection refused");
});
