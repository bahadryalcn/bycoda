// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import {
  listAutomations,
  newAutomationDraft,
  notifyAutomationsChanged,
  peekAutomations,
  saveAutomation,
  subscribeAutomations,
  type Automation,
} from "./automations";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
const automation = (id: string, name = id): Automation => ({
  ...newAutomationDraft("/work/project", "codex", "model"),
  id,
  name,
  prompt: "Review",
  createdAt: 1,
  updatedAt: 1,
  nextRunAt: 0,
});
beforeEach(() => {
  invoke.mockReset();
  notifyAutomationsChanged();
});

it("publishes a confirmed upsert without reloading the list or moving existing rows", async () => {
  const a = automation("a"),
    b = automation("b"),
    edited = { ...a, name: "Edited", updatedAt: 2 };
  invoke.mockImplementation(async (command) => (command === "automations_list" ? [a, b] : edited));
  await listAutomations();
  const changed = vi.fn(),
    stop = subscribeAutomations(changed);
  await saveAutomation(edited);
  expect(peekAutomations()).toEqual([edited, b]);
  expect(changed).toHaveBeenCalledWith({ upsert: edited });
  expect(invoke.mock.calls.filter(([command]) => command === "automations_list")).toHaveLength(1);
  stop();
});

it("does not let a list started before an edit overwrite its confirmed result", async () => {
  const a = automation("a"),
    edited = { ...a, name: "Edited", updatedAt: 2 };
  invoke.mockResolvedValueOnce([a]);
  await listAutomations();
  let release!: (items: Automation[]) => void;
  invoke.mockImplementation(async (command) =>
    command === "automations_list"
      ? new Promise<Automation[]>((resolve) => {
          release = resolve;
        })
      : edited,
  );
  const pending = listAutomations();
  await saveAutomation(edited);
  release([a]);
  expect(await pending).toEqual([edited]);
  expect(peekAutomations()).toEqual([edited]);
});
