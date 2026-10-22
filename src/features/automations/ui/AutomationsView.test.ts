// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createAutomationTrigger,
  listAutomations,
  newAutomationDraft,
  notifyAutomationsChanged,
  peekAutomations,
  type Automation,
} from "../model/automations";
import { SUPPORTED_INBOX_TRIGGER_EVENTS } from "../model/automationEvents";
import * as hostAutomationClient from "../model/hostAutomationClient";
import {
  AutomationsView as RawAutomationsView,
  EventTriggerSentence,
  TRIGGER_EVENTS,
} from "./AutomationsView";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
const AutomationsView = withQueryClient(RawAutomationsView);

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
    onFocusChanged: async () => () => {},
    isFullscreen: async () => false,
  }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetRetainedState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  notifyAutomationsChanged();
  invoke.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("shows the cached automation list immediately and refreshes it without a loading screen", async () => {
  const automation: Automation = {
    ...newAutomationDraft("/work/project", "codex", "model"),
    id: "test-automation",
    name: "Daily review",
    nextRunAt: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  invoke.mockResolvedValue([automation]);
  await listAutomations();
  let finish!: (automations: Automation[]) => void;
  const refresh = new Promise<Automation[]>((resolve) => {
    finish = resolve;
  });
  invoke.mockReturnValue(refresh);
  await act(async () =>
    root.render(
      createElement(AutomationsView, {
        cwd: "/work/project",
        recents: [],
        onClose: vi.fn(),
        onLaunch: vi.fn(),
        onOpenSession: vi.fn(),
      }),
    ),
  );
  expect(container.querySelector('[aria-label="Open Daily review"]')).not.toBeNull();
  expect(container.querySelector(".animate-spin")).toBeNull();

  await act(async () => finish([{ ...automation, name: "Updated review" }]));
  expect(container.querySelector('[aria-label="Open Updated review"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Open Daily review"]')).toBeNull();
});

it("invalidates the cached list when an automation changes", async () => {
  invoke.mockResolvedValue([]);
  await listAutomations();
  expect(peekAutomations()).toEqual([]);
  notifyAutomationsChanged();
  expect(peekAutomations()).toBeNull();
});

it("keeps an edited automation draft across host invalidation and saves the edited values", async () => {
  let automation: Automation = {
    ...newAutomationDraft("/work/project", "codex", "model"),
    id: "edited-automation",
    name: "Daily review",
    prompt: "Review the workspace",
    nextRunAt: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  invoke.mockImplementation(async (command: string, args?: any) => {
    if (command === "automations_list") return [automation];
    if (command === "automations_upsert") {
      automation = { ...args.automation, createdAt: 1, updatedAt: 2 };
      return automation;
    }
    if (command.endsWith("_status")) return { connected: false };
    return [];
  });
  await act(async () =>
    root.render(
      createElement(AutomationsView, {
        cwd: "/work/project",
        recents: [],
        onClose: vi.fn(),
        onLaunch: vi.fn(),
        onOpenSession: vi.fn(),
        onOpenBackgroundSession: vi.fn(),
      }),
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Open Daily review"]')!.click(),
  );
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Automation name"]')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, "Edited daily review");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => notifyAutomationsChanged());
  expect(input.value).toBe("Edited daily review");
  const save = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Save",
  )!;
  expect(save.disabled).toBe(false);
  const listReads = invoke.mock.calls.filter(([command]) => command === "automations_list").length;
  await act(async () => save.click());
  expect(invoke.mock.calls.filter(([command]) => command === "automations_list")).toHaveLength(
    listReads,
  );
  expect(invoke).toHaveBeenCalledWith("automations_upsert", {
    automation: expect.objectContaining({
      id: "edited-automation",
      name: "Edited daily review",
      prompt: "Review the workspace",
    }),
  });
  expect(container.querySelector('[aria-label="Open Edited daily review"]')).not.toBeNull();
});

it("shows run-history read failures with retry instead of claiming the automation never ran", async () => {
  const automation: Automation = {
    ...newAutomationDraft("/work/history-project", "codex", "model"),
    id: "history-automation",
    name: "History review",
    nextRunAt: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  let failHistory = true;
  invoke.mockImplementation(async (command: string) => {
    if (command === "automations_list") return [automation];
    if (command === "automation_runs_list") {
      if (failHistory) throw new Error("History is unavailable");
      return [];
    }
    if (command.endsWith("_status")) return { connected: false };
    return [];
  });
  await act(async () =>
    root.render(
      createElement(AutomationsView, {
        cwd: "/work/history-project",
        recents: [],
        onClose: vi.fn(),
        onLaunch: vi.fn(),
        onOpenSession: vi.fn(),
      }),
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Open History review"]')!.click(),
  );
  const historyTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (button) => button.textContent === "Run history",
  )!;
  await act(async () => historyTab.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "History is unavailable",
  );
  expect(container.textContent).not.toContain("This automation has not run yet.");
  failHistory = false;
  const retry = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent === "Retry",
  )!;
  await act(async () => retry.click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("This automation has not run yet.");
});

it("offers exactly the inbox events that can fire, each under its own label", () => {
  for (const [kind, supported] of Object.entries(SUPPORTED_INBOX_TRIGGER_EVENTS)) {
    const offered = TRIGGER_EVENTS[kind as keyof typeof TRIGGER_EVENTS];
    expect(offered.map((event) => event.value).sort()).toEqual([...supported].sort());
    const labels = offered.map((event) => event.label);
    expect(labels.every((label) => label.trim())).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  }
});

it("names the GitHub state-change triggers for what happened", () => {
  const labels = Object.fromEntries(
    TRIGGER_EVENTS.github.map((event) => [event.value, event.label]),
  );
  expect(labels).toMatchObject({
    issue_reopened: "Issue reopened",
    issue_closed: "Issue closed",
    pull_request_reopened: "Pull request reopened",
    pull_request_closed: "Pull request closed",
    pull_request_merged: "Pull request merged",
    pull_request_ready_for_review: "Pull request ready for review",
    issue_labeled: "Issue labeled",
    pull_request_labeled: "Pull request labeled",
  });
});

async function renderSentence(
  trigger: ReturnType<typeof createAutomationTrigger>,
  onChange = vi.fn(),
) {
  await act(async () =>
    root.render(
      createElement(EventTriggerSentence, {
        trigger,
        branchOptions: [],
        projectChosen: true,
        onChange,
      }),
    ),
  );
  return onChange;
}

it("lets a label-added trigger name the label it waits for", async () => {
  const trigger = createAutomationTrigger("github", "issue_labeled");
  const onChange = await renderSentence(trigger);
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Label"]');
  expect(input).not.toBeNull();
  expect(input!.value).toBe("");
  expect(input!.placeholder).toBe("any label");
  expect(container.textContent).toContain("added to issue");

  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, "auto-fix");
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledWith({ ...trigger, label: "auto-fix" });
});

it("shows the saved label and words the sentence for pull requests", async () => {
  await renderSentence(
    createAutomationTrigger("github", "pull_request_labeled", {
      label: "needs-review",
    }),
  );
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Label"]')?.value).toBe(
    "needs-review",
  );
  expect(container.textContent).toContain("added to pull request");
});

it("has no label field on triggers that are not about labels", async () => {
  await renderSentence(createAutomationTrigger("github", "issue_reopened"));
  expect(container.querySelector('input[aria-label="Label"]')).toBeNull();
  expect(container.textContent).toContain("Issue reopened");
});

async function renderControlEditor(overrides: Partial<Automation> = {}) {
  const automation: Automation = {
    ...newAutomationDraft("/work/controls", "codex", "model"),
    id: "controls-automation",
    name: "Controls review",
    prompt: "Review changes",
    nextRunAt: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
  invoke.mockImplementation(async (command: string, args?: any) => {
    if (command === "automations_list") return [automation];
    if (command === "automations_upsert") return { ...args.automation, createdAt: 1, updatedAt: 2 };
    if (command.endsWith("_status")) return { connected: false };
    return [];
  });
  await act(async () =>
    root.render(
      createElement(AutomationsView, {
        cwd: automation.cwd,
        recents: [],
        onClose: vi.fn(),
        onLaunch: vi.fn(),
        onOpenSession: vi.fn(),
        onOpenBackgroundSession: vi.fn(),
      }),
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Open Controls review"]')!.click(),
  );
  return automation;
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("keeps edited drafts while the compact filter popover changes and resets the collection", async () => {
  await renderControlEditor();
  const name = container.querySelector<HTMLInputElement>('[aria-label="Automation name"]')!;
  await changeInput(name, "Retained draft");
  const filter = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Filter automations"]',
  )!;
  await act(async () => filter.click());
  const search = document.querySelector<HTMLInputElement>(
    '[role="dialog"][aria-label="Filter automations"] input',
  )!;
  await changeInput(search, "no-match");
  expect(filter.hasAttribute("data-button-selected")).toBe(true);
  expect(container.querySelector('[aria-label="Open Controls review"]')).toBeNull();
  expect(name.value).toBe("Retained draft");
  const reset = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '[role="dialog"][aria-label="Filter automations"] button',
    ),
  ).find((node) => node.textContent?.trim() === "Reset")!;
  await act(async () => reset.click());
  expect(container.querySelector('[aria-label="Open Controls review"]')).not.toBeNull();
  expect(filter.hasAttribute("data-button-selected")).toBe(false);
  expect(name.value).toBe("Retained draft");
});

it("restores unsaved automation work after returning to the tool without sharing it with another host", async () => {
  await renderControlEditor();
  await changeInput(
    container.querySelector<HTMLInputElement>('[aria-label="Automation name"]')!,
    "Unsaved owner draft",
  );
  await act(async () => root.unmount());
  root = createRoot(container);
  const show = async (cwd: string) => {
    await act(async () =>
      root.render(
        createElement(AutomationsView, {
          cwd,
          recents: [],
          onClose: vi.fn(),
          onLaunch: vi.fn(),
          onOpenSession: vi.fn(),
          onOpenBackgroundSession: vi.fn(),
        }),
      ),
    );
  };
  await show("/work/controls");
  expect(container.querySelector<HTMLInputElement>('[aria-label="Automation name"]')?.value).toBe(
    "Unsaved owner draft",
  );
  await act(async () => root.unmount());
  root = createRoot(container);
  await show("remote://other-machine/work/controls");
  expect(container.querySelector('[aria-label="Automation name"]')).toBeNull();
  expect(invoke.mock.calls.some(([command]) => command === "automations_upsert")).toBe(false);
});

it("searches trigger events by provider while retaining readiness gates and saves added schedules", async () => {
  const automation = await renderControlEditor();
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label^="Add Trigger:"]')!;
  const before = container.querySelectorAll('[aria-label="Remove trigger"]').length;
  await act(async () => trigger.click());
  const search = document.querySelector<HTMLInputElement>('input[placeholder="Search triggers"]')!;
  await changeInput(search, "GitHub");
  const unavailable = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'));
  expect(unavailable.length).toBeGreaterThan(0);
  expect(unavailable.every((node) => node.disabled)).toBe(true);
  expect(document.body.textContent).toContain("Connect GitHub in Settings");
  await act(async () => unavailable[0].click());
  expect(container.querySelectorAll('[aria-label="Remove trigger"]')).toHaveLength(before);
  await changeInput(search, "Daily");
  const daily = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(
    (node) => !node.disabled && node.textContent?.includes("Daily"),
  )!;
  await act(async () => daily.click());
  expect(container.querySelectorAll('[aria-label="Remove trigger"]')).toHaveLength(before + 1);
  const save = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (node) => node.textContent?.trim() === "Save",
  )!;
  await act(async () => save.click());
  const saved = invoke.mock.calls.find(([command]) => command === "automations_upsert")![1]
    .automation;
  expect(saved.triggers).toHaveLength(automation.triggers.length + 1);
  expect(saved.triggers.at(-1)).toEqual(
    expect.objectContaining({ kind: "time", scheduleKind: "daily" }),
  );
});

it("uses the shared action menu while preserving the native delete confirmation gate", async () => {
  await renderControlEditor();
  const previousConfirmation = window.confirm;
  const confirmation = vi.fn(() => false);
  window.confirm = confirmation;
  try {
    const actions = container.querySelector<HTMLButtonElement>(
      '[aria-label="Automation actions"]',
    )!;
    await act(async () => actions.click());
    const item = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    expect(item.textContent).toContain("Delete automation");
    await act(async () => item.click());
    expect(confirmation).toHaveBeenCalledOnce();
    expect(invoke.mock.calls.some(([command]) => command === "automations_delete")).toBe(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(actions);
  } finally {
    window.confirm = previousConfirmation;
  }
});

it("blocks duplicate run actions and deletion while a manual run is pending", async () => {
  await renderControlEditor();
  const previous = invoke.getMockImplementation()!;
  let finish!: (run: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  invoke.mockImplementation((command: string, args?: unknown) =>
    command === "automation_run_now" ? pending : previous(command, args),
  );
  const run = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (node) => node.textContent?.trim() === "Run now",
  )!;
  await act(async () => run.click());
  expect(run.disabled).toBe(true);
  await act(async () => run.click());
  expect(invoke.mock.calls.filter(([command]) => command === "automation_run_now")).toHaveLength(1);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Automation actions"]')!.click(),
  );
  expect(document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.disabled).toBe(true);
  await act(async () =>
    finish({ id: "run", automationId: "controls-automation", status: "running", createdAt: 1 }),
  );
  expect(run.disabled).toBe(false);
});

it("keeps the twenty-trigger limit visible and unavailable", async () => {
  await renderControlEditor({
    triggers: Array.from({ length: 20 }, () => createAutomationTrigger("time", "daily")),
  });
  expect(
    container.querySelector<HTMLButtonElement>('button[aria-label^="Add Trigger:"]')!.disabled,
  ).toBe(true);
  expect(container.querySelectorAll('[aria-label="Remove trigger"]')).toHaveLength(20);
});

it.each([false, true])(
  "locks the entire editor and pending portal callbacks during a save (background=%s)",
  async (background) => {
    await renderControlEditor({
      host: background
        ? { machineId: "machine", machineName: "Test machine", projectId: "project" }
        : undefined,
    });
    const previous = invoke.getMockImplementation()!;
    let rejectSave!: (reason: Error) => void;
    const pending = new Promise<Automation>((_resolve, reject) => {
      rejectSave = reject;
    });
    const hostSave = vi.spyOn(hostAutomationClient, "saveHostAutomation").mockReturnValue(pending);
    invoke.mockImplementation((command: string, args?: unknown) =>
      command === "automations_upsert" ? pending : previous(command, args),
    );
    try {
      const name = container.querySelector<HTMLInputElement>('[aria-label="Automation name"]')!;
      await changeInput(name, "Submitted review");
      const form = name.closest("form")!;
      const triggers = container.querySelectorAll('[aria-label="Remove trigger"]').length;
      await act(async () =>
        container.querySelector<HTMLButtonElement>('button[aria-label^="Add Trigger:"]')!.click(),
      );
      const option = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
      ).find((node) => !node.disabled && node.textContent?.includes("Daily"))!;
      await act(async () =>
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
      expect(form.hasAttribute("inert")).toBe(true);
      expect(form.getAttribute("aria-busy")).toBe("true");
      expect(name.disabled).toBe(true);
      // A portal already open before submission is outside the inert form.
      await act(async () => option.click());
      expect(container.querySelectorAll('[aria-label="Remove trigger"]')).toHaveLength(triggers);
      const reset = Array.from(form.querySelectorAll<HTMLButtonElement>("button")).find(
        (node) => node.textContent?.trim() === "Reset",
      )!;
      await act(async () => reset.click());
      await act(async () =>
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
      if (background) expect(hostSave).toHaveBeenCalledOnce();
      else
        expect(
          invoke.mock.calls.filter(([command]) => command === "automations_upsert"),
        ).toHaveLength(1);
      await act(async () => rejectSave(new Error("Save unavailable")));
      expect(form.hasAttribute("inert")).toBe(false);
      expect(form.getAttribute("aria-busy")).toBe("false");
      expect(name.disabled).toBe(false);
      expect(name.value).toBe("Submitted review");
      expect(container.textContent).toContain("Save unavailable");
      await changeInput(name, "Retry review");
      expect(name.value).toBe("Retry review");
    } finally {
      hostSave.mockRestore();
    }
  },
);

it("locks new automation creation until its submitted snapshot finishes saving", async () => {
  await renderControlEditor();
  const findButton = (text: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (node) => node.textContent?.trim() === text,
    )!;
  await act(async () => findButton("New automation").click());
  const template = container.querySelectorAll<HTMLButtonElement>(".automation-template")[1];
  await act(async () => template.click());
  const name = container.querySelector<HTMLInputElement>('[aria-label="Automation name"]')!;
  await changeInput(name, "Created review");
  const previous = invoke.getMockImplementation()!;
  let finish!: (automation: Automation) => void;
  const pending = new Promise<Automation>((resolve) => {
    finish = resolve;
  });
  invoke.mockImplementation((command: string, args?: unknown) =>
    command === "automations_upsert" ? pending : previous(command, args),
  );
  await act(async () => findButton("Create").click());
  const form = name.closest("form")!;
  expect(form.hasAttribute("inert")).toBe(true);
  expect(name.disabled).toBe(true);
  await act(async () => findButton("New automation").click());
  expect(container.querySelector('[aria-label="Automation name"]')).toBe(name);
  await act(async () => findButton("Cancel").click());
  expect(container.querySelector('[aria-label="Automation name"]')).toBe(name);
  const submitted = invoke.mock.calls.find(([command]) => command === "automations_upsert")![1]
    .automation;
  await act(async () => finish({ ...submitted, createdAt: 1, updatedAt: 1 }));
  const savedName = container.querySelector<HTMLInputElement>('[aria-label="Automation name"]')!;
  expect(savedName.value).toBe("Created review");
  expect(savedName.disabled).toBe(false);
  expect(savedName.closest("form")!.hasAttribute("inert")).toBe(false);
});

it("keeps same-ID local and host automations independent and preserves the host project during edits", async () => {
  const base: Automation = {
    ...newAutomationDraft("/work/controls", "codex", "model"),
    id: "controls-automation",
    name: "Host A review",
    prompt: "Review changes",
    nextRunAt: 0,
    createdAt: 1,
    updatedAt: 1,
    host: { machineId: "host-a", machineName: "Host A", projectId: "project-a" },
  };
  const other: Automation = {
    ...base,
    name: "Host B review",
    cwd: "remote://host-b/work/controls",
    host: { machineId: "host-b", machineName: "Host B", projectId: "project-b" },
  };
  let hosts = [base, other];
  const lists = vi
    .spyOn(hostAutomationClient, "listHostAutomationResults")
    .mockImplementation(async () =>
      hosts.map((automation) => ({
        machineId: automation.host!.machineId,
        machineName: automation.host!.machineName,
        data: [automation],
        status: "ok" as const,
        stale: false,
      })),
    );
  const history = vi.spyOn(hostAutomationClient, "listHostAutomationRuns").mockResolvedValue([]);
  const save = vi
    .spyOn(hostAutomationClient, "saveHostAutomation")
    .mockImplementation(async (_machines, draft) => {
      const saved = { ...base, ...draft };
      hosts = [saved, other];
      return saved;
    });
  const run = vi.spyOn(hostAutomationClient, "runHostAutomationNow").mockResolvedValue(undefined);
  const remove = vi
    .spyOn(hostAutomationClient, "deleteHostAutomation")
    .mockResolvedValue(undefined);
  const previousConfirm = window.confirm;
  window.confirm = vi.fn(() => true);
  try {
    await renderControlEditor();
    const open = async (name: string) =>
      act(async () =>
        container.querySelector<HTMLButtonElement>(`[aria-label="Open ${name}"]`)!.click(),
      );
    await open("Host A review");
    let name = container.querySelector<HTMLInputElement>('[aria-label="Automation name"]')!;
    expect(name.value).toBe("Host A review");
    const picker = container.querySelector<HTMLButtonElement>(
      '[aria-label^="Switch project, current project"]',
    )!;
    expect(picker.disabled).toBe(true);
    await act(async () => picker.click());
    expect(container.querySelector('[role="dialog"][aria-label="Switch project"]')).toBeNull();
    await changeInput(name, "Edited host A");
    await act(async () =>
      name.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(save).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ id: base.id, cwd: base.cwd, name: "Edited host A" }),
    );
    expect(container.querySelector('[aria-label="Open Host B review"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open Controls review"]')).not.toBeNull();
    await open("Host B review");
    name = container.querySelector<HTMLInputElement>('[aria-label="Automation name"]')!;
    expect(name.value).toBe("Host B review");
    expect(history).toHaveBeenLastCalledWith(expect.objectContaining({ host: other.host }));
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    const runButton = Array.from(
      name.closest("form")!.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "Run now")!;
    await act(async () => runButton.click());
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ host: other.host }));
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Automation actions"]')!.click(),
    );
    await act(async () => document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ host: other.host }));
    expect(container.querySelector('[aria-label="Open Host B review"]')).toBeNull();
    expect(container.querySelector('[aria-label="Open Edited host A"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open Controls review"]')).not.toBeNull();
  } finally {
    lists.mockRestore();
    history.mockRestore();
    save.mockRestore();
    run.mockRestore();
    remove.mockRestore();
    window.confirm = previousConfirm;
  }
});
