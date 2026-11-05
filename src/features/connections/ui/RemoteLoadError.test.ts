// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteConnectionStatus } from "../model/remoteConnection";
import { RemoteLoadError } from "./RemoteLoadError";

const state = vi.hoisted(() => ({
  status: "unreachable" as RemoteConnectionStatus,
  auto: true,
  requested: false,
}));
vi.mock("../model/useRemoteConnection", () => ({
  useRemoteConnection: () => ({
    status: state.status,
    reconnecting: state.requested,
    reconnect: vi.fn(),
    machine: undefined,
  }),
}));
vi.mock("./RemoteConnectionFeedback", () => ({ useRemoteConnectionFeedback: () => true }));
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
it("shows waiting progress only while automatic recovery can run", async () => {
  await render();
  expect(container.querySelector("[data-loading-layout]")).not.toBeNull();
  state.auto = false;
  await render();
  expect(container.querySelector("[data-loading-layout]")).toBeNull();
  expect(container.querySelector('[role="status"]')).not.toBeNull();
});
it.each([
  "identity-mismatch",
  "connection-blocked",
  "needs-auth",
  "host-key",
  "outdated-host",
] as const)("does not pretend recovery is running for %s", async (status) => {
  state.status = status;
  await render();
  expect(container.querySelector("[data-loading-layout]")).toBeNull();
});
it("keeps hard per-source failures neutral before shared state catches up", async () => {
  state.status = "connected";
  await render("RPC_WS_BLOCKED: Host authentication was refused");
  expect(container.querySelector("[data-loading-layout]")).toBeNull();
});
it("retains loaded content without adding a duplicate status row", async () => {
  await render("Machine is unreachable", true);
  expect(container.textContent).toBe("");
});
