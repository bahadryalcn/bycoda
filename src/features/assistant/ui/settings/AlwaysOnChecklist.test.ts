// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AlwaysOnChecklist } from "./AlwaysOnChecklist";

let root: Root | undefined, container: HTMLDivElement;
const profile = {
  enabled: false,
  setupComplete: false,
  autonomy: "report",
  execution: null,
  dailyTokenBudget: 0,
  keepAwakeWhileWorking: false,
  keepAwakeWhileAway: false,
  observationTaskDone: false,
  observationTaskNeedsInput: false,
  notificationAway: "urgent",
  quietStart: 22,
  quietEnd: 8,
};
async function mount(
  request: (input: any) => Promise<any>,
  onOpen?: (target: string) => void,
  profileOverrides: Partial<typeof profile> = {},
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const wrapped = vi.fn(request);
  await act(async () =>
    root!.render(
      createElement(AlwaysOnChecklist, {
        request: wrapped as any,
        snapshot: {
          profile: { ...profile, ...profileOverrides },
          keepAwake: { supported: true },
        } as any,
        onOpen: onOpen as any,
      }),
    ),
  );
  return wrapped;
}
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

it("summarizes ready checks and keeps the complete checklist behind a disclosure", async () => {
  await mount(
    async (input) =>
      input.op === "alwaysOn.get"
        ? { alwaysOn: { pushPhones: 1, assistantPushPhones: 1 } }
        : { modelPool: { rows: [{ roles: ["worker"] }] } },
    undefined,
    {
      enabled: true,
      setupComplete: true,
      autonomy: "jobs",
      dailyTokenBudget: 100000,
      keepAwakeWhileWorking: true,
      observationTaskDone: true,
      observationTaskNeedsInput: true,
    },
  );
  expect(container.textContent).toContain("8 of 10 checks ready");
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(details.textContent).toContain("Assistant is turned on");
  expect(details.textContent).toContain("The Host keeps running after you sign out");
  await act(async () => details.querySelector("summary")!.click());
  expect(details.open).toBe(true);
});

it("only reads on mount and shows unknown when the reads fail", async () => {
  const request = await mount(async () => {
    throw new Error("offline");
  });
  expect(request.mock.calls.map(([input]) => input.op).sort()).toEqual([
    "alwaysOn.get",
    "models.pool.get",
  ]);
  expect(container.textContent).toContain("Unknown");
});

it("offers a fix button only through onOpen and never changes settings itself", async () => {
  const onOpen = vi.fn();
  const request = await mount(
    async (input) =>
      input.op === "alwaysOn.get"
        ? { alwaysOn: { pushPhones: 0, assistantPushPhones: 0 } }
        : { modelPool: { rows: [], version: 0, updatedAt: 0, derived: true } },
    onOpen,
  );
  expect(request).toHaveBeenCalledTimes(2);
  const open = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Open settings",
  )!;
  await act(async () => open.click());
  expect(onOpen).toHaveBeenCalledWith("access");
  expect(request.mock.calls.every(([input]) => input.op.endsWith(".get"))).toBe(true);
});
