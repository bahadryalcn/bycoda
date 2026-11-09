// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AssistantSnapshot } from "../../../shared/model/host-contracts/assistant";
import type { ManualSupervisionGrant } from "../../../shared/model/assistantManual";
const mocks = vi.hoisted(() => ({ request: vi.fn(), locked: false }));
vi.mock("../model/assistantClient", () => ({ assistantRequest: mocks.request }));
vi.mock("../../group-lock/model/groupLock", () => ({ isProjectLocked: () => mocks.locked }));
vi.mock("../../../shared/i18n", () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
  useLocale: () => "en",
}));
import { useManualSupervision, type ManualState } from "../model/assistantManual";
import { ManualSessionSupervision } from "./ManualSessionSupervision";
let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
const projects = [{ id: "one", path: "/visible", name: "Visible project" }];
const candidate = {
  sessionId: "manual-one",
  projectId: "one",
  title: "Owner conversation",
  sourceToken: "a".repeat(64),
  eligible: true,
};
const grant: ManualSupervisionGrant = {
  id: "grant",
  sessionId: "enrolled",
  title: "Captured source title",
  version: 3,
  active: true,
  source: {
    projectId: "one",
    executionCwd: "/visible",
    harness: "codex",
    model: "real-model",
    modelSettings: {},
    runtimeMode: "default",
  },
  sourceToken: "b".repeat(64),
  enrolledAt: 1,
  updatedAt: 1,
};
function state(enabled = true): ManualState {
  return {
    policy: { enabled, version: 4, projectIds: ["hidden", "one"] },
    grants: [grant],
    candidates: [
      candidate,
      { ...candidate, sessionId: "hidden", projectId: "hidden", title: "Secret candidate" },
    ],
  };
}
let current = state();
let latestController: ReturnType<typeof useManualSupervision>;
function snapshot(chief = true): AssistantSnapshot {
  return {
    profile: { autonomy: chief ? "chief" : "report", enabled: true, setupComplete: true },
    manualPolicy: current.policy,
    manualGrants: current.grants,
  } as AssistantSnapshot;
}
function Harness({
  settings = false,
  chief = true,
  visible = projects,
  onOpenSession,
  environmentId = "host-a",
  saveRef,
}: {
  settings?: boolean;
  chief?: boolean;
  visible?: typeof projects;
  onOpenSession?: (id: string) => Promise<void>;
  environmentId?: string | null;
  saveRef?: { current: (() => Promise<void>) | null };
}) {
  const controller = useManualSupervision(
    snapshot(chief),
    visible,
    true,
    environmentId ?? undefined,
  );
  latestController = controller;
  return createElement(ManualSessionSupervision, {
    controller,
    projects: visible,
    settings,
    onOpenSession,
    saveRef,
  });
}
const button = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent === name || element.getAttribute("aria-label") === name,
  )!;
const click = async (name: string) => {
  await act(async () => {
    button(name).click();
    await Promise.resolve();
  });
};
const render = async (props: Parameters<typeof Harness>[0] = {}) => {
  await act(() => root.render(createElement(Harness, props)));
};
const toggleProject = async (name = "Visible project") => {
  await act(() => container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click());
  await act(() => {
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((element) =>
      element.textContent?.includes(name),
    );
    expect(option).toBeDefined();
    option!.click();
  });
};
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  current = state();
  mocks.locked = false;
  mocks.request.mockReset();
  mocks.request.mockImplementation(async () => ({ manual: current }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("shows only visible candidates and captures exact backend source/version on enrollment", async () => {
  current.grants.push({
    ...grant,
    id: "hidden-grant",
    sessionId: "hidden-session",
    title: "Secret grant",
    source: { ...grant.source, projectId: "hidden" },
  });
  await render();
  expect(container.textContent).toContain("Captured source title");
  expect(container.textContent).not.toContain("Secret");
  await click("Enroll conversation");
  expect(mocks.request).toHaveBeenCalledWith(
    {
      op: "manual.enroll",
      sessionId: candidate.sessionId,
      sourceToken: candidate.sourceToken,
      expectedVersion: 0,
    },
    "host-a",
  );
});
it("keeps Off independent of a pending enrollment and rejects its late response", async () => {
  await render();
  const enroll = deferred<any>();
  mocks.request.mockImplementation((request: any) =>
    request.op === "manual.enroll"
      ? enroll.promise
      : Promise.resolve({
          manual: { ...current, policy: { ...current.policy, enabled: false, version: 5 } },
        }),
  );
  await click("Enroll conversation");
  expect(button("Turn off supervision").disabled).toBe(false);
  await click("Turn off supervision");
  expect(container.textContent).toContain("Manual session supervision is off.");
  expect(mocks.request).toHaveBeenCalledWith(
    { op: "manual.policy", expectedVersion: 4, enabled: false, projectIds: ["hidden", "one"] },
    "host-a",
  );
  await act(() => enroll.resolve({ manual: current }));
  expect(container.textContent).toContain("Manual session supervision is off.");
  expect(button("Enroll conversation").disabled).toBe(true);
});
it("keeps Off usable while initial candidate loading is pending", async () => {
  const list = deferred<any>();
  mocks.request.mockImplementation((request: any) =>
    request.op === "manual.list"
      ? list.promise
      : Promise.resolve({
          manual: { ...current, policy: { ...current.policy, enabled: false, version: 5 } },
        }),
  );
  await render();
  await click("Turn off supervision");
  await act(() => list.resolve({ manual: current }));
  expect(container.textContent).toContain("Manual session supervision is off.");
});
it("shows policy conflicts honestly and retains independent Off for refresh and retry", async () => {
  await render();
  mocks.request.mockRejectedValueOnce(new Error("Policy changed; refresh before retrying."));
  await click("Turn off supervision");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Policy changed");
  expect(button("Turn off supervision").disabled).toBe(false);
  expect(container.textContent).not.toContain("Manual session supervision is off.");
});
it("preserves hidden saved scope while editing visible membership without revealing it", async () => {
  await render({ settings: true });
  expect(container.textContent).not.toContain("hidden");
  await toggleProject();
  await click("Save project scope");
  expect(mocks.request).toHaveBeenCalledWith(
    { op: "manual.policy", expectedVersion: 4, enabled: true, projectIds: ["hidden"] },
    "host-a",
  );
});
it("distinguishes same-name projects by path and saves their exact IDs", async () => {
  await render({
    settings: true,
    visible: [
      { id: "one", name: "Same project", path: "/first/checkout" },
      { id: "two", name: "Same project", path: "/second/checkout" },
    ],
  });
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
  await act(() => container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click());
  const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  expect(options).toHaveLength(2);
  expect(options[0].textContent).toContain("/first/checkout");
  expect(options[1].textContent).toContain("/second/checkout");
  await act(() => options[1].click());
  await click("Save project scope");
  expect(mocks.request).toHaveBeenCalledWith(
    {
      op: "manual.policy",
      expectedVersion: 4,
      enabled: true,
      projectIds: ["hidden", "one", "two"],
    },
    "host-a",
  );
});
it("requires Chief for enrollment but keeps owner revocation and Off available", async () => {
  await render({ chief: false });
  expect(button("Enroll conversation").disabled).toBe(true);
  expect(button("Revoke supervision").disabled).toBe(false);
  await click("Revoke supervision");
  expect(mocks.request).toHaveBeenCalledWith(
    { op: "manual.revoke", id: "grant", expectedVersion: 3 },
    "host-a",
  );
  expect(button("Turn off supervision").disabled).toBe(false);
});
it("removes rows immediately when visibility changes and refuses stale locked-source enrollment", async () => {
  await render();
  mocks.locked = true;
  await click("Enroll conversation");
  expect(mocks.request.mock.calls.some(([request]) => request.op === "manual.enroll")).toBe(false);
  await render({ visible: [] });
  expect(container.textContent).not.toContain("Owner conversation");
  expect(container.textContent).not.toContain("Captured source title");
});
it("retains source-changed errors and uses the revoked grant version when retrying enrollment", async () => {
  current.grants = [{ ...grant, sessionId: candidate.sessionId, active: false, version: 8 }];
  await render();
  mocks.request.mockRejectedValueOnce(
    new Error(
      "The selected conversation changed; refresh its backend source token before enrolling.",
    ),
  );
  await click("Enroll conversation");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("conversation changed");
  expect(mocks.request).toHaveBeenLastCalledWith(
    expect.objectContaining({ sourceToken: candidate.sourceToken, expectedVersion: 8 }),
    "host-a",
  );
});
it("surfaces rejected navigation locally so Open can be retried", async () => {
  const onOpenSession = vi.fn().mockRejectedValue(new Error("Host offline"));
  await render({ onOpenSession });
  await click("Open session");
  expect(container.textContent).toContain("Host offline");
  expect(button("Open session").disabled).toBe(false);
});
it("does not silently replace a newer writer's scope while an owner draft is retained", async () => {
  await render({ settings: true });
  await toggleProject();
  current = {
    ...current,
    policy: { ...current.policy, version: 9, projectIds: ["hidden", "one"] },
  };
  await render({ settings: true });
  mocks.request.mockRejectedValueOnce(
    new Error("Manual supervision policy changed; reload before saving."),
  );
  await click("Save project scope");
  expect(mocks.request).toHaveBeenLastCalledWith(
    { op: "manual.policy", expectedVersion: 4, enabled: true, projectIds: ["hidden"] },
    "host-a",
  );
  expect(container.textContent).toContain("Project scope changed. Your unsaved selection is kept.");
  await click("Reload saved scope");
  await click("Save project scope");
  expect(mocks.request).toHaveBeenLastCalledWith(
    { op: "manual.policy", expectedVersion: 9, enabled: true, projectIds: ["hidden", "one"] },
    "host-a",
  );
});
it("requires a fresh explicit enrollment when the actual execution source changes", async () => {
  current.candidates = [{ ...candidate, sessionId: grant.sessionId, enrolledSourceChanged: true }];
  await render();
  expect(container.textContent).toContain(
    "Execution changed. Enroll again to supervise this source.",
  );
  await click("Enroll again");
  expect(mocks.request).toHaveBeenLastCalledWith(
    {
      op: "manual.enroll",
      sessionId: grant.sessionId,
      sourceToken: candidate.sourceToken,
      expectedVersion: 3,
    },
    "host-a",
  );
});
it("can turn off while an enabling policy request is pending", async () => {
  current = state(false);
  await render({ settings: true });
  const enabling = deferred<any>();
  mocks.request.mockImplementation((request: any) =>
    request.enabled
      ? enabling.promise
      : Promise.resolve({
          manual: { ...current, policy: { ...current.policy, enabled: false, version: 6 } },
        }),
  );
  await act(() => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(button("Turn off supervision").disabled).toBe(false);
  await click("Turn off supervision");
  await act(() =>
    enabling.resolve({
      manual: { ...current, policy: { ...current.policy, enabled: true, version: 5 } },
    }),
  );
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
});
it("settles candidate loading under StrictMode effect replay", async () => {
  await act(() => root.render(createElement(StrictMode, null, createElement(Harness))));
  expect(button("Enroll conversation").disabled).toBe(false);
  expect(button("Refresh").disabled).toBe(false);
});
it("does not expose a global enrollment count in a capacity error", async () => {
  await render();
  mocks.request.mockRejectedValueOnce(
    new Error("The assistant already has 100 active manual supervision grants."),
  );
  await click("Enroll conversation");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "No more conversations can be enrolled. Revoke supervision before adding another.",
  );
  expect(container.textContent).not.toContain("100");
});
it("discards an old Host enrollment result and refuses its captured actions after a Host switch", async () => {
  await render();
  const oldController = latestController;
  const enrollment = deferred<any>();
  mocks.request.mockImplementation((request: any) =>
    request.op === "manual.enroll" ? enrollment.promise : Promise.resolve({ manual: current }),
  );
  await click("Enroll conversation");
  current = {
    ...state(),
    candidates: [
      { ...candidate, title: "Replacement Host conversation", sourceToken: "c".repeat(64) },
    ],
    grants: [],
  };
  await render({ environmentId: "host-b" });
  expect(container.textContent).toContain("Replacement Host conversation");
  await act(() => enrollment.resolve({ manual: state() }));
  expect(container.textContent).not.toContain("Owner conversation");
  expect(container.textContent).not.toContain("Captured source title");
  const calls = mocks.request.mock.calls.length;
  await act(async () => {
    await oldController.enroll(candidate);
    await oldController.off();
  });
  expect(mocks.request).toHaveBeenCalledTimes(calls);
  expect(mocks.request).toHaveBeenCalledWith(
    expect.objectContaining({ op: "manual.enroll", sourceToken: candidate.sourceToken }),
    "host-a",
  );
  expect(mocks.request).toHaveBeenLastCalledWith({ op: "manual.list" }, "host-b");
});
it("does not adopt a former Host Off acknowledgement into the replacement Host policy", async () => {
  await render();
  const off = deferred<any>();
  mocks.request.mockImplementation((request: any) =>
    request.op === "manual.policy" ? off.promise : Promise.resolve({ manual: current }),
  );
  await click("Turn off supervision");
  await render({ environmentId: "host-b" });
  await act(() =>
    off.resolve({ manual: { ...state(false), policy: { ...state(false).policy, version: 99 } } }),
  );
  expect(container.textContent).not.toContain("Manual session supervision is off.");
  expect(button("Turn off supervision").disabled).toBe(false);
  expect(latestController.data?.policy.version).toBe(4);
  expect(mocks.request).toHaveBeenCalledWith(
    expect.objectContaining({ op: "manual.policy", enabled: false }),
    "host-a",
  );
});
it("conceals old policy and candidates and makes no request without a captured Host identity", async () => {
  await render();
  const oldController = latestController;
  await render({ environmentId: null });
  mocks.request.mockClear();
  expect(container.textContent).not.toContain("Owner conversation");
  expect(container.textContent).not.toContain("Captured source title");
  await act(async () => {
    await latestController.refresh();
    await latestController.off();
    await oldController.save(false, []);
  });
  expect(mocks.request).not.toHaveBeenCalled();
  expect(latestController.data).toBeNull();
});
it("registers one shell save that applies the draft switch and scope, and hides the local Save", async () => {
  const saveRef: { current: (() => Promise<void>) | null } = { current: null };
  current = state(false);
  await render({ settings: true, saveRef });
  expect(typeof saveRef.current).toBe("function");
  expect(container.textContent).not.toContain("Save project scope");
  expect(container.textContent).not.toContain("Saving project scope does not enroll");
  await act(() => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(mocks.request.mock.calls.some(([request]) => request.op === "manual.policy")).toBe(false);
  // The Host applies the saved policy and returns it; the default mock would echo the old state.
  mocks.request.mockImplementationOnce(async (request: any) => {
    current = {
      ...current,
      policy: { ...current.policy, enabled: request.enabled, version: 5 },
    };
    return { manual: current };
  });
  await act(() => saveRef.current!());
  expect(mocks.request).toHaveBeenLastCalledWith(
    { op: "manual.policy", expectedVersion: 4, enabled: true, projectIds: ["hidden", "one"] },
    "host-a",
  );
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
});
it("makes the shell save throw on refusal and keeps the owner's draft", async () => {
  const saveRef: { current: (() => Promise<void>) | null } = { current: null };
  current = state(false);
  await render({ settings: true, saveRef });
  await act(() => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  mocks.request.mockRejectedValueOnce(
    new Error("Manual supervision policy changed; reload before saving."),
  );
  let failure: unknown;
  await act(async () => {
    try {
      await saveRef.current!();
    } catch (cause) {
      failure = cause;
    }
  });
  expect(String(failure)).toContain("Manual supervision was not saved");
  expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
});
it("does not render the settings switch in Room Sessions", async () => {
  current = state(false);
  await render();
  expect(container.textContent).not.toContain("Supervise my conversations");
  expect(container.querySelector('[role="switch"]')).toBeNull();
});
