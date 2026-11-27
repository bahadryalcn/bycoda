// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteConnectionStatus } from "../model/remoteConnection";
import type { RemoteFailure } from "../model/remoteFailure";
import {
  RemoteConnectionFeedbackProvider,
  RemoteConnectionNotice,
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
    state.machines.get(environmentId) ?? {
      status: "connected",
      reconnecting: false,
    },
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
    recovering,
    onDismiss,
  }: {
    cwd: string;
    failure: RemoteFailure;
    coordinated: boolean;
    recovering?: boolean;
    onDismiss?: () => void;
  }) =>
    createElement(
      "div",
      {
        role: "alert",
        "data-remote-connection-notice": cwd,
        "data-machine": cwd,
        "data-coordinated": String(coordinated),
      },
      recovering ? "Reconnecting…" : failure.message,
      onDismiss && createElement("button", { onClick: onDismiss }, "Dismiss"),
    ),
}));

type Consumer = { id: string; cwd: string; failure?: RemoteFailure };
const outage: RemoteFailure = {
  kind: "unreachable",
  message: "Machine is unreachable",
};
let root: Root;
let container: HTMLDivElement;

function Pane({ cwd, failure }: Consumer) {
  const shared = useRemoteConnectionFeedback(cwd, failure);
  return createElement("div", { "data-pane": cwd }, shared ? "shared" : "local");
}
/** Each consumer's machine has its session open, with that session's notice outlet. */
async function render(consumers: Consumer[], wrap = true, outlet = true) {
  const machines = new Set(consumers.map(({ cwd }) => cwd.replace(/^remote:\/\/([^/]+).*$/, "$1")));
  const children: ReactNode[] = outlet
    ? [...machines].map((machine) =>
        createElement(RemoteConnectionNotice, { key: machine, cwdOrEnvironmentId: machine }),
      )
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

it("shares one reconnecting state and does not restart its deadline for repeated panel failures", async () => {
  state.machines.set("env", { status: "unreachable", error: outage.message });
  const consumers = [
    { id: "files", cwd: "remote://env/repo", failure: outage },
    { id: "git", cwd: "remote://env/repo", failure: outage },
  ];
  await render(consumers);
  expect(container.querySelectorAll("[data-pane]")).toHaveLength(2);
  expect(container.textContent).toBe("sharedshared");
  expect(notices()).toHaveLength(0);
  await advance(1_000);
  await render(
    consumers.map((consumer) => ({
      ...consumer,
      failure: {
        ...outage,
        message: "SSH timed out connecting to the machine.",
      },
    })),
  );
  await advance(999);
  expect(notices()).toHaveLength(0);
  await advance(1);
  expect(notices()).toHaveLength(1);
  expect(container.textContent).toContain("Reconnecting…");
  await advance(42_999);
  expect(container.textContent).toContain("Reconnecting…");
  await advance(1);
  expect(notices()).toHaveLength(1);
  expect(container.textContent).not.toContain("Reconnecting…");
  expect(container.querySelector("[data-coordinated]")?.getAttribute("data-coordinated")).toBe(
    "false",
  );
});

it("clears reconnecting when the active pane recovers within the grace period", async () => {
  state.machines.set("env", { status: "unreachable" });
  await render([{ id: "session", cwd: "env", failure: outage }]);
  await advance(1_000);
  state.machines.set("env", { status: "connected" });
  await render([{ id: "session", cwd: "env" }]);
  await advance(5_000);
  expect(notices()).toHaveLength(0);
});

it("ignores a pane's stale unreachable failure once the machine is connected", async () => {
  const consumers = [{ id: "files", cwd: "remote://env/repo", failure: outage }];
  state.machines.set("env", { status: "unreachable" });
  await render(consumers);
  await advance(2_000);
  expect(notices()).toHaveLength(1);
  state.machines.set("env", { status: "connected" });
  await render(consumers);
  expect(notices()).toHaveLength(0);
  await advance(60_000);
  expect(notices()).toHaveLength(0);
});

it("does not present an old outage as a fresh blip when a notice mounts late", async () => {
  const { recordRemoteConnection, resetRemoteHealth } = await import("../model/remoteHealth");
  resetRemoteHealth();
  await act(async () => recordRemoteConnection("env", new Error("Machine is unreachable")));
  await advance(120_000);
  state.machines.set("env", { status: "unreachable" });
  await render([{ id: "files", cwd: "remote://env/repo", failure: outage }]);
  expect(notices()).toHaveLength(1);
  expect(container.textContent).not.toContain("Reconnecting…");
  resetRemoteHealth();
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
      failure: {
        kind: "unreachable",
        message: "RPC_WS_BLOCKED: Host admission was refused",
      },
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
  await advance(2_000);
  expect(notices()).toHaveLength(1);
  await render(consumers, true, false);
  expect(notices()).toHaveLength(0);
  expect(container.querySelector("[data-pane]")?.textContent).toBe("local");
});

it("keeps a single notice if two sessions of one machine are open and hands over on unmount", async () => {
  state.machines.set("env", { status: "identity-mismatch" });
  const outlets = async (first: boolean) => {
    const children = [
      ...(first
        ? [createElement(RemoteConnectionNotice, { key: "first", cwdOrEnvironmentId: "env" })]
        : []),
      createElement(RemoteConnectionNotice, {
        key: "second",
        cwdOrEnvironmentId: "remote://env/other",
      }),
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

it("dismisses only one outage episode and never hides a later hard refusal", async () => {
  state.autoReconnect = false;
  state.machines.set("a", { status: "unreachable" });
  state.machines.set("b", { status: "unreachable" });
  const consumers = [
    { id: "a", cwd: "a", failure: outage },
    { id: "b", cwd: "b", failure: outage },
  ];
  await render(consumers);
  expect(notices()).toHaveLength(2);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-machine="a"] button')!.click(),
  );
  expect(notices()).toHaveLength(1);
  state.machines.set("a", {
    status: "connection-blocked",
    error: "RPC_WS_TLS: refused",
  });
  await render(consumers);
  expect(notices()).toHaveLength(2);
  state.machines.set("a", { status: "connected" });
  await render([{ id: "a", cwd: "a" }, consumers[1]!]);
  await advance(0);
  state.machines.set("a", { status: "unreachable" });
  await render(consumers);
  expect(notices()).toHaveLength(2);
});

it("raises no notice for a machine in an outage whose session is not open", async () => {
  const { recordRemoteConnection, resetRemoteHealth } = await import("../model/remoteHealth");
  resetRemoteHealth();
  state.machines.set("a", { status: "unreachable" });
  state.machines.set("b", { status: "unreachable" });
  await render([]);
  await act(async () => {
    recordRemoteConnection("a", new Error("Machine is unreachable"));
    recordRemoteConnection("b", new Error("Machine is unreachable"));
  });
  await advance(60_000);
  expect(notices()).toHaveLength(0);
  // Opening one machine's session shows that machine's notice there, and only that one.
  await render([{ id: "pane", cwd: "remote://a/repo", failure: outage }]);
  expect(notices().map((n) => n.getAttribute("data-remote-connection-notice"))).toEqual(["a"]);
  resetRemoteHealth();
});

it("hands a pane's failure back when only another machine's session is open", async () => {
  state.machines.set("a", { status: "unreachable" });
  await act(async () =>
    root.render(
      createElement(RemoteConnectionFeedbackProvider, {
        children: [
          createElement(RemoteConnectionNotice, { key: "b", cwdOrEnvironmentId: "b" }),
          createElement(Pane, { key: "pane", id: "pane", cwd: "remote://a/repo", failure: outage }),
        ],
      }),
    ),
  );
  expect(container.querySelector("[data-pane]")?.textContent).toBe("local");
});

it("hides shared connection errors while a machine notice is visible or about to be", async () => {
  const { isConnectionErrorShownCentrally } =
    await import("../../../shared/ui/connectionErrorGate");
  const remote = "RPC_HOST_UNAVAILABLE: Machine is unreachable";
  state.machines.set("env", { status: "unreachable", error: outage.message });
  await render([{ id: "files", cwd: "remote://env/repo", failure: outage }]);
  // The quiet window shows no notice, and panes stay quiet too: a blip while
  // loading or reconnecting must not flash a pane error the notice would replace.
  expect(notices()).toHaveLength(0);
  expect(isConnectionErrorShownCentrally(remote)).toBe(true);
  await advance(2_500);
  expect(notices()).toHaveLength(1);
  expect(isConnectionErrorShownCentrally(remote)).toBe(true);
  // A bare socket error of a local command is not this machine's outage.
  expect(isConnectionErrorShownCentrally("Connection reset by peer")).toBe(false);
  expect(isConnectionErrorShownCentrally("fatal: not a git repository")).toBe(false);
  state.machines.set("env", { status: "connected" });
  await render([]);
  expect(notices()).toHaveLength(0);
  expect(isConnectionErrorShownCentrally(remote)).toBe(false);
});
