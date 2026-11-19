// @vitest-environment happy-dom
import { act, createElement, type FormEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Automation, AutomationDraft } from "../model/automations";
import { useAutomationActions } from "./useAutomationActions";

const api = vi.hoisted(() => ({ save: vi.fn(), run: vi.fn() }));
vi.mock("../model/hostAutomationClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/hostAutomationClient")>()),
  saveHostAutomation: api.save,
  runHostAutomationNow: api.run,
}));

let root: Root;
let actions: ReturnType<typeof useAutomationActions>;
let deps: Parameters<typeof useAutomationActions>[0];
const hostAutomation = {
  id: "job",
  name: "Job",
  cwd: "/repo",
  host: { machineId: "mac" },
} as Automation;
const event = { preventDefault: vi.fn() } as unknown as FormEvent;
const draft = {
  name: "Job",
  prompt: "Run",
  cwd: "/repo",
  runInBackground: true,
  hostCreateId: "create-1",
  triggers: [],
} as unknown as AutomationDraft;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  deps = {
    machines: [],
    confirmSaved: vi.fn(),
    confirmDeleted: vi.fn(),
    refreshHost: vi.fn(async () => {}),
    selected: null,
    selectedId: null,
    runs: [],
    errorStamp: {},
    confirm: vi.fn(async () => false),
    setPickerOpen: vi.fn(),
    setDraft: vi.fn(),
    setSelectedId: vi.fn(),
    onLaunch: vi.fn(),
  };
  function Probe() {
    actions = useAutomationActions(deps);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("treats an accepted Host save as saved when its follow-up refresh fails", async () => {
  api.save.mockResolvedValueOnce(hostAutomation);
  vi.mocked(deps.refreshHost).mockRejectedValueOnce(new Error("list failed"));
  await act(async () => actions.onSave(event, draft));
  expect(deps.confirmSaved).toHaveBeenCalledExactlyOnceWith(hostAutomation);
  expect(deps.setDraft).toHaveBeenCalledWith(null);
  expect(actions.actionError).toBeNull();
});

it("keeps the editor open with an action error when a Host save is not accepted", async () => {
  api.save.mockRejectedValueOnce(new Error("Host did not answer"));
  await act(async () => actions.onSave(event, draft));
  expect(deps.confirmSaved).not.toHaveBeenCalled();
  expect(deps.setDraft).not.toHaveBeenCalledWith(null);
  expect(actions.actionError).toBe("Host did not answer");
});

it("treats an accepted Host run as started when its follow-up refresh fails", async () => {
  api.run.mockResolvedValueOnce(undefined);
  vi.mocked(deps.refreshHost).mockRejectedValueOnce(new Error("list failed"));
  await act(async () => actions.onRun(hostAutomation));
  expect(api.run).toHaveBeenCalledExactlyOnceWith(hostAutomation);
  expect(actions.actionError).toBeNull();
  expect(actions.running).toBeNull();
});

it("admits no second Host run while an accepted run's refresh is pending", async () => {
  api.run.mockResolvedValue(undefined);
  let failRefresh!: (reason: Error) => void;
  vi.mocked(deps.refreshHost).mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        failRefresh = reject;
      }),
  );
  let first!: Promise<void>;
  await act(async () => {
    first = actions.onRun(hostAutomation);
  });
  await act(async () => actions.onRun(hostAutomation));
  expect(api.run).toHaveBeenCalledExactlyOnceWith(hostAutomation);
  await act(async () => {
    failRefresh(new Error("list failed"));
    await first;
  });
  expect(actions.actionError).toBeNull();
  expect(actions.running).toBeNull();
});
