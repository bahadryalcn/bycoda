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
  shared: true,
}));
vi.mock("../model/useRemoteConnection", () => ({
  useRemoteConnection: () => ({
    status: state.status,
    reconnecting: state.requested,
    reconnect: vi.fn(),
    machine: { id: "env", name: "Server", ssh: true },
  }),
}));
vi.mock("./RemoteConnectionFeedback", () => ({ useRemoteConnectionFeedback: () => state.shared }));
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

it("keeps the compact title, reconnect and disclosure in one row", async () => {
  state.shared = false;
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
  const details = row?.querySelector("details");
  expect(details?.open).toBe(false);
  expect(details?.querySelector("summary")?.textContent).toContain("Details");
  expect(details?.textContent).toContain("SSH timed out");
  expect(details?.textContent).toContain("Connection settings");
});
