// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Automation, AutomationRun } from "../model/automations";
import { automationKey } from "../model/automationKey";
import { useAutomationActions } from "./useAutomationActions";

const api = vi.hoisted(() => ({ manual: vi.fn(), host: vi.fn(), pause: vi.fn() }));
vi.mock("../model/automations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/automations")>()),
  createManualAutomationRun: api.manual,
}));
vi.mock("../model/hostAutomationClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/hostAutomationClient")>()),
  runHostAutomationNow: api.host,
  setHostAutomationEnabled: api.pause,
}));

let root: Root;
let actions: ReturnType<typeof useAutomationActions>;
let deps: Parameters<typeof useAutomationActions>[0];
const automation = { id: "job", name: "Job", cwd: "/repo" } as Automation;
const run = { id: "run", automationId: "job", trigger: "manual" } as AutomationRun;

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

it("admits one manual run for synchronous duplicate requests", async () => {
  let finish!: () => void;
  api.manual.mockImplementation(
    () =>
      new Promise<AutomationRun>((resolve) => {
        finish = () => resolve(run);
      }),
  );
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = actions.onRun(automation);
    second = actions.onRun(automation);
  });
  expect(api.manual).toHaveBeenCalledExactlyOnceWith("job");
  await act(async () => {
    finish();
    await Promise.all([first, second]);
  });
  expect(deps.onLaunch).toHaveBeenCalledExactlyOnceWith(automation, run);
  expect(actions.running).toBeNull();
});

it("keeps different Host targets independent and preserves the newer target's pending state", async () => {
  const pending = new Map<string, () => void>();
  api.host.mockImplementation(
    (target: Automation) =>
      new Promise<void>((resolve) => {
        pending.set(automationKey(target), resolve);
      }),
  );
  const firstTarget = { ...automation, host: { machineId: "first" } } as Automation;
  const secondTarget = { ...automation, host: { machineId: "second" } } as Automation;
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = actions.onRun(firstTarget);
  });
  await act(async () => {
    second = actions.onRun(secondTarget);
  });
  expect(api.host).toHaveBeenCalledTimes(2);
  expect(actions.running).toBe(automationKey(secondTarget));
  await act(async () => actions.onDelete(firstTarget));
  expect(deps.confirm).not.toHaveBeenCalled();
  await act(async () => {
    pending.get(automationKey(firstTarget))!();
    await first;
  });
  expect(actions.running).toBe(automationKey(secondTarget));
  await act(async () => {
    pending.get(automationKey(secondTarget))!();
    await second;
  });
  expect(actions.running).toBeNull();
});

it("releases a rejected manual request for retry and retains its error feedback", async () => {
  api.manual.mockRejectedValueOnce(new Error("Admission unavailable")).mockResolvedValueOnce(run);
  await act(async () => actions.onRun(automation));
  expect(actions.actionError).toBe("Admission unavailable");
  expect(actions.running).toBeNull();
  await act(async () => actions.onRun(automation));
  expect(api.manual).toHaveBeenCalledTimes(2);
  expect(deps.onLaunch).toHaveBeenCalledExactlyOnceWith(automation, run);
  expect(actions.running).toBeNull();
});

it("reloads the Host list and reports the refusal when a pause was based on a stale copy", async () => {
  const conflict = new Error("Configuration changed in another client. Reopen it.");
  api.pause.mockRejectedValueOnce(conflict);
  const hosted = { ...automation, host: { machineId: "first" } } as Automation;
  await act(async () => actions.onToggle(hosted, false));
  expect(api.pause).toHaveBeenCalledExactlyOnceWith(hosted, false);
  expect(deps.refreshHost).toHaveBeenCalledOnce();
  expect(actions.actionError).toContain("Configuration changed in another client");
  expect(actions.toggling.size).toBe(0);
});
