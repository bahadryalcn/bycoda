// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  state: "stopped",
  failStatus: false,
  statusReads: 0,
  start: vi.fn(async () => null as unknown),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    if (command === "local_host_status") host.statusReads++;
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
// Scoped to the pending card: the sheet's summary line is a status region too.
const notice = () => document.body.querySelector('.notification-pending-card [role="status"]');
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

it("refreshes the status at once after a start and warns again when the host dies right after", async () => {
  host.state = "stopped";
  await render();
  await poll();
  await openNotifications();
  const statusReads = host.statusReads;

  const start = [...notice()!.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Start host"),
  )!;
  await act(async () => start.click());
  // The start itself re-reads the status; it does not wait for the next tick.
  expect(host.statusReads).toBe(statusReads + 1);
  expect(notice()).toBeNull();

  // The host is still (or again) stopped: the start must not keep the warning dismissed.
  await poll();
  expect(notice()).not.toBeNull();
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
  expect(notice()?.textContent).toContain("could not be started");
  await openNotifications();
  expect(notice()).toBeNull();
  await openNotifications();
  expect(notice()?.textContent).toContain("could not be started");
  // The desktop's own text is behind Details.
  expect(notice()?.textContent).not.toContain("did not start");
  await act(async () =>
    [...document.body.querySelectorAll("button")]
      .find((entry) => entry.textContent === "Details")!
      .click(),
  );
  expect(document.body.textContent).toContain("did not start");
});

it("explains an update without offering a start, and a dismissal does not hide a later stop", async () => {
  host.state = "updating";
  await render();
  await poll();
  await openNotifications();
  expect(notice()?.textContent).toContain("being updated");
  expect(
    [...notice()!.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("Start host"),
    ),
  ).toBe(false);
  await act(async () => {
    notice()!.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!.click();
  });
  expect(notice()).toBeNull();

  host.state = "stopped";
  await poll();
  await poll();
  expect(notice()?.textContent).toContain("not running");
});

it("stays silent while the host runs or starts", async () => {
  for (const state of ["running", "starting", "absent", "unknown"]) {
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
  expect(document.body.textContent).toContain("All clear");
});
