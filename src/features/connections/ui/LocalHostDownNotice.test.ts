// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  state: "stopped",
  failStatus: false,
  start: vi.fn(async () => null as unknown),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    if (command === "local_host_status" && host.failStatus) {
      host.failStatus = false;
      throw new Error("Status unavailable");
    }
    return command === "local_host_status"
      ? { state: host.state }
      : command === "local_host_start"
        ? host.start()
        : null;
  },
}));

import { ApprovalToasts } from "../../sessions/ui/ApprovalToasts";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  vi.useRealTimers();
  host.start.mockClear();
  host.failStatus = false;
});

async function render() {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(ApprovalToasts, {
        notices: [],
        onFocusSession: vi.fn(),
        onApproval: vi.fn(),
      }),
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  };
}

const poll = () => act(async () => void (await vi.advanceTimersByTimeAsync(15_000)));
const notice = () => document.body.querySelector('[role="alert"]');
const openNotifications = () =>
  act(async () => {
    document.body.querySelector<HTMLButtonElement>('button[aria-label="Notifications"]')!.click();
  });

it("offers to start a host that stays stopped, and starts it on request", async () => {
  host.state = "stopped";
  await render();
  // A host restarting itself is silent for one poll; that alone is not shown.
  expect(notice()).toBeNull();
  await poll();
  expect(notice()).toBeNull();
  expect(document.body.querySelector('button[aria-label="Notifications"]')?.textContent).toContain(
    "1",
  );
  await openNotifications();
  expect(document.body.querySelector('[role="dialog"]')?.contains(notice())).toBe(true);
  expect(notice()?.textContent).toContain("not running");

  const start = [...notice()!.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Start host"),
  )!;
  await act(async () => start.click());
  expect(host.start).toHaveBeenCalledTimes(1);
  expect(notice()).toBeNull();
});

it("shows the reason when the host cannot be started", async () => {
  host.state = "stopped";
  host.start.mockRejectedValueOnce(new Error("The host on this computer did not start."));
  await render();
  await poll();
  await openNotifications();
  const start = [...notice()!.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Start host"),
  )!;
  await act(async () => start.click());
  expect(notice()?.textContent).toContain("did not start");
  await openNotifications();
  expect(notice()).toBeNull();
  await openNotifications();
  expect(notice()?.textContent).toContain("did not start");
});

it("stays silent while the host runs or updates", async () => {
  for (const state of ["running", "updating", "absent", "unknown"]) {
    host.state = state;
    await render();
    await poll();
    expect(notice()).toBeNull();
    cleanup?.();
    cleanup = undefined;
  }
});

it("clears a stopped warning when health becomes uncertain and requires fresh confirmation", async () => {
  host.state = "stopped";
  await render();
  await poll();
  await openNotifications();
  expect(notice()).not.toBeNull();

  host.state = "unknown";
  await poll();
  expect(notice()).toBeNull();
  host.state = "stopped";
  await poll();
  expect(notice()).toBeNull();
  await poll();
  expect(notice()).not.toBeNull();
});

it("requires consecutive stopped results after a failed status request", async () => {
  host.state = "stopped";
  await render();
  host.failStatus = true;
  await poll();
  await poll();
  await openNotifications();
  expect(notice()).toBeNull();
  await poll();
  expect(notice()).not.toBeNull();
  host.failStatus = true;
  await poll();
  expect(notice()).toBeNull();
});

it("removes recovered hosts and only restores a dismissed notice after another outage", async () => {
  host.state = "stopped";
  await render();
  await poll();
  await openNotifications();
  await act(async () => {
    notice()!.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!.click();
  });
  await poll();
  expect(notice()).toBeNull();

  host.state = "running";
  await poll();
  host.state = "stopped";
  await poll();
  expect(notice()).toBeNull();
  await poll();
  expect(notice()).not.toBeNull();

  host.state = "running";
  await poll();
  expect(notice()).toBeNull();
  expect(document.body.textContent).toContain("No pending requests");
});
