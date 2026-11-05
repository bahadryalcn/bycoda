// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteConnectionStatus } from "../model/remoteConnection";
import type { RemoteFailure } from "../model/remoteFailure";
import {
  RemoteConnectionFeedbackProvider,
  RemoteConnectionNotices,
  useRemoteConnectionFeedback,
} from "./RemoteConnectionFeedback";

const state = vi.hoisted(() => ({
  machines: new Map<
    string,
    { status: RemoteConnectionStatus; error?: string; reconnecting?: boolean }
  >(),
  autoReconnect: true,
}));
vi.mock("../model/useRemoteConnection", () => ({
  useRemoteConnection: (environmentId: string) =>
    state.machines.get(environmentId) ?? { status: "connected", reconnecting: false },
}));
vi.mock("../../settings/model/settings", () => ({
  loadRemoteAutoReconnect: () => state.autoReconnect,
  subscribeRemoteAutoReconnect: () => () => {},
}));
vi.mock("./RemoteLoadError", () => ({
  RemoteLoadError: ({
    cwd,
    failure,
    coordinated,
  }: {
    cwd: string;
    failure: RemoteFailure;
    coordinated: boolean;
  }) =>
    createElement(
      "div",
      { role: "alert", "data-machine": cwd, "data-coordinated": String(coordinated) },
      failure.message,
    ),
}));

type Consumer = { id: string; cwd: string; failure?: RemoteFailure };
const outage: RemoteFailure = { kind: "unreachable", message: "Machine is unreachable" };
let root: Root;
let container: HTMLDivElement;

function Pane({ cwd, failure }: Consumer) {
  const shared = useRemoteConnectionFeedback(cwd, failure);
  return createElement("div", { "data-pane": cwd }, shared ? "shared" : "local");
}
async function render(consumers: Consumer[], wrap = true, outlet = true) {
  const children: ReactNode[] = outlet
    ? [createElement(RemoteConnectionNotices, { key: "notices" })]
    : [];
  children.push(
    ...consumers.map((consumer) => createElement(Pane, { key: consumer.id, ...consumer })),
  );
  await act(async () =>
    root.render(wrap ? createElement(RemoteConnectionFeedbackProvider, { children }) : children),
  );
}
async function advance(milliseconds: number) {
  await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
}
const notices = () => [...container.querySelectorAll("[data-remote-connection-notice]")];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.machines.clear();
  state.autoReconnect = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shares one delayed notice and does not restart its deadline for repeated panel failures", async () => {
  state.machines.set("env", { status: "unreachable", error: outage.message });
  const consumers = [
    { id: "files", cwd: "remote://env/repo", failure: outage },
    { id: "git", cwd: "remote://env/repo", failure: outage },
  ];
  await render(consumers);
  expect(container.querySelectorAll("[data-pane]")).toHaveLength(2);
  expect(container.textContent).toBe("sharedshared");
  expect(notices()).toHaveLength(0);
  await advance(4_000);
  await render(
    consumers.map((consumer) => ({
      ...consumer,
      failure: { ...outage, message: "SSH timed out connecting to the machine." },
    })),
  );
  await advance(3_999);
  expect(notices()).toHaveLength(0);
  await advance(1);
  expect(notices()).toHaveLength(1);
  expect(container.querySelector("[data-coordinated]")?.getAttribute("data-coordinated")).toBe(
    "false",
  );
});

it("does not flash a notice when the active pane recovers within the grace period", async () => {
  state.machines.set("env", { status: "unreachable" });
  await render([{ id: "session", cwd: "env", failure: outage }]);
  await advance(3_000);
  state.machines.set("env", { status: "connected" });
  await render([{ id: "session", cwd: "env" }]);
  await advance(10_000);
  expect(notices()).toHaveLength(0);
});

it("retains a pane's reported failure when a sibling request alone reports the machine connected", async () => {
  const consumers = [{ id: "files", cwd: "remote://env/repo", failure: outage }];
  state.machines.set("env", { status: "unreachable" });
  await render(consumers);
  await advance(8_000);
  expect(notices()).toHaveLength(1);
  state.machines.set("env", { status: "connected" });
  await render(consumers);
  expect(notices()).toHaveLength(1);
  await render([{ id: "files", cwd: "remote://env/repo" }]);
  expect(notices()).toHaveLength(0);
});

it.each<RemoteConnectionStatus>([
  "needs-auth",
  "host-key",
  "identity-mismatch",
  "connection-blocked",
  "outdated-host",
])("shows actionable %s immediately", async (status) => {
  state.machines.set("env", { status, error: "Owner action is required" });
  await render([{ id: "session", cwd: "env" }]);
  expect(notices()).toHaveLength(1);
  expect(container.querySelector("[role=alert]")?.textContent).toContain("Owner action");
});

it("does not delay a typed native authentication refusal even if another request says connected", async () => {
  await render([
    {
      id: "session",
      cwd: "env",
      failure: { kind: "unreachable", message: "RPC_WS_BLOCKED: Host admission was refused" },
    },
  ]);
  expect(notices()).toHaveLength(1);
});

it("keeps a current hard refusal visible over a pane's earlier network failure", async () => {
  state.machines.set("env", {
    status: "connection-blocked",
    error: "RPC_WS_BLOCKED: Owner sign-in is required",
  });
  await render([{ id: "session", cwd: "env", failure: outage }]);
  expect(notices()).toHaveLength(1);
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "Owner sign-in is required",
  );
});

it("hands feedback back to panes when the actual common outlet is absent", async () => {
  const consumers = [{ id: "files", cwd: "remote://env/repo", failure: outage }];
  state.machines.set("env", { status: "unreachable" });
  await render(consumers, true, false);
  expect(container.querySelector("[data-pane]")?.textContent).toBe("local");
  await render(consumers);
  expect(container.querySelector("[data-pane]")?.textContent).toBe("shared");
  await advance(8_000);
  expect(notices()).toHaveLength(1);
  await render(consumers, true, false);
  expect(notices()).toHaveLength(0);
  expect(container.querySelector("[data-pane]")?.textContent).toBe("local");
});

it("keeps a single notice if shell outlets overlap and hands over on unmount", async () => {
  state.machines.set("env", { status: "identity-mismatch" });
  const outlets = async (first: boolean) => {
    const children = [
      ...(first ? [createElement(RemoteConnectionNotices, { key: "first" })] : []),
      createElement(RemoteConnectionNotices, { key: "second" }),
      createElement(Pane, { id: "pane", key: "pane", cwd: "env" }),
    ];
    await act(async () =>
      root.render(createElement(RemoteConnectionFeedbackProvider, { children })),
    );
  };
  await outlets(true);
  expect(notices()).toHaveLength(1);
  await outlets(false);
  expect(notices()).toHaveLength(1);
});

it("removes only the last departing consumer's machine notice", async () => {
  state.machines.set("a", { status: "identity-mismatch" });
  state.machines.set("b", { status: "connection-blocked" });
  const consumers = [
    { id: "a-files", cwd: "a" },
    { id: "a-git", cwd: "a" },
    { id: "b-session", cwd: "b" },
  ];
  await render(consumers);
  expect(notices()).toHaveLength(2);
  await render(consumers.slice(1));
  expect(notices()).toHaveLength(2);
  await render(consumers.slice(2));
  expect(notices()).toHaveLength(1);
  expect(notices()[0]?.getAttribute("data-remote-connection-notice")).toBe("b");
});

it.each(["disabled automatic recovery", "requested reconnect"])(
  "does not impose quiet grace on %s",
  async (mode) => {
    state.autoReconnect = mode !== "disabled automatic recovery";
    state.machines.set("env", {
      status: "unreachable",
      reconnecting: mode === "requested reconnect",
    });
    await render([{ id: "session", cwd: "env", failure: outage }]);
    expect(notices()).toHaveLength(1);
  },
);

it("leaves standalone, local-path and operation-specific errors with their initiating pane", async () => {
  await render([{ id: "standalone", cwd: "remote://env/repo", failure: outage }], false);
  expect(container.textContent).toBe("local");
  await render([
    { id: "local", cwd: "C:/repo", failure: outage },
    {
      id: "operation",
      cwd: "remote://env/repo",
      failure: { kind: "other", message: "Not a Git repository" },
    },
  ]);
  expect(container.textContent).toBe("locallocal");
  expect(notices()).toHaveLength(0);
});
