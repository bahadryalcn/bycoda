// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteConnectionStatus } from "../model/remoteConnection";
import { SUPERSEDED_CONNECTION } from "../model/remoteLifecycle";
import { RemoteLoadError } from "./RemoteLoadError";

const state = vi.hoisted(() => ({
  status: "unreachable" as RemoteConnectionStatus,
  auto: true,
  requested: false,
  shared: true,
  reconnect: vi.fn(),
}));
vi.mock("../model/useRemoteConnection", () => ({
  useRemoteConnection: () => ({
    status: state.status,
    reconnecting: state.requested,
    reconnect: state.reconnect,
    machine: { id: "env", name: "Server", ssh: true },
  }),
}));
vi.mock("./RemoteConnectionFeedback", () => ({
  useRemoteConnectionFeedback: () => state.shared,
}));
vi.mock("../../settings/model/settings", () => ({
  loadRemoteAutoReconnect: () => state.auto,
  subscribeRemoteAutoReconnect: () => () => {},
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  state.status = "unreachable";
  state.auto = true;
  state.requested = false;
  state.shared = true;
  state.reconnect.mockReset();
  state.reconnect.mockResolvedValue({ ok: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(message = "Machine is unreachable", stale = false) {
  await act(async () =>
    root.render(
      createElement(RemoteLoadError, {
        cwd: "remote://env/repo",
        failure: { kind: "unreachable", message },
        stale,
      }),
    ),
  );
}
it("suppresses duplicate status while the shared owner is mounted", async () => {
  await render();
  expect(container.textContent).toBe("");
  state.auto = false;
  await render();
  expect(container.textContent).toBe("");
});
it("retains loaded content without adding a duplicate status row", async () => {
  await render("Machine is unreachable", true);
  expect(container.textContent).toBe("");
});

it("keeps the compact notice to one row and the raw transport text behind Details", async () => {
  state.shared = false;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  await act(async () =>
    root.render(
      createElement(RemoteLoadError, {
        cwd: "env",
        failure: { kind: "unreachable", message: "SSH timed out" },
        compact: true,
      }),
    ),
  );
  const row = container.querySelector("[data-remote-feedback-row]");
  expect(row?.textContent).toContain("Server");
  expect(row?.querySelector("button")?.textContent).toContain("Reconnect");
  expect(row?.querySelector("details")).toBeNull();
  // The bar never carries the raw message or the secondary actions.
  expect(container.textContent).not.toContain("SSH timed out");
  expect(container.textContent).not.toContain("Connection settings");
  const details = [...row!.querySelectorAll("button")].find(
    (entry) => entry.textContent === "Details",
  )!;
  expect(details.getAttribute("aria-haspopup")).toBe("dialog");
  await act(async () => details.click());
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("SSH timed out");
  expect(dialog?.textContent).toContain("Edit address…");
  expect(dialog?.textContent).toContain("Connection settings");
  // Opening another surface closes the popover first.
  await act(async () =>
    [...dialog!.querySelectorAll("button")]
      .find((entry) => entry.textContent?.includes("Connection settings"))!
      .click(),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  vi.unstubAllGlobals();
});

it("shows the secondary actions in the row when there is no message to explain", async () => {
  state.shared = false;
  await act(async () =>
    root.render(
      createElement(RemoteLoadError, {
        cwd: "env",
        failure: { kind: "unreachable", message: "" },
        compact: true,
      }),
    ),
  );
  const row = container.querySelector("[data-remote-feedback-row]");
  expect(row?.textContent).not.toContain("Details");
  expect(row?.textContent).toContain("Connection settings");
});

it("ignores a reconnect superseded by Cancel or an address edit", async () => {
  state.shared = false;
  state.reconnect.mockResolvedValue({
    ok: false,
    error: SUPERSEDED_CONNECTION,
  });
  await render();
  const button = [...container.querySelectorAll("button")].find((entry) =>
    entry.textContent?.includes("Reconnect"),
  );
  await act(async () => button?.click());
  expect(state.reconnect).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("Reconnecting failed");
});

it("shows why a reconnect that really failed did not work", async () => {
  state.shared = false;
  state.reconnect.mockResolvedValue({ ok: false, error: "SSH timed out" });
  await render();
  const button = [...container.querySelectorAll("button")].find((entry) =>
    entry.textContent?.includes("Reconnect"),
  );
  await act(async () => button?.click());
  expect(container.textContent).toContain("Reconnecting failed: SSH timed out");
});
