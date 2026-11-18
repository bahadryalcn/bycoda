// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  reconnect: vi.fn(async (_args: unknown) => null as unknown),
}));
const local = {
  id: "local",
  name: "This computer (local sync)",
  endpoint: "http://127.0.0.1:47321",
  environmentId: "env-local",
  localHost: true,
};
const office = {
  id: "office",
  name: "Office",
  endpoint: "https://office.invalid",
  environmentId: "env-office",
};
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: unknown) => {
    if (command === "local_host_status") return { state: "running" };
    if (command === "remote_machines") return [local, office];
    if (command === "local_host_reconnect") return host.reconnect(args);
    return null;
  },
}));

import { ApprovalToasts } from "../../sessions/ui/ApprovalToasts";
import { adoptRemoteMachineInventory } from "../model/connections";
import { applyRemoteConnection, resetRemoteHealth } from "../model/remoteHealth";

const refusal = "Host rejected request [RPC_AUTHORIZATION] (environment.describe).";
let cleanup: (() => void) | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host.reconnect.mockReset().mockResolvedValue(local);
  adoptRemoteMachineInventory([local, office]);
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  resetRemoteHealth();
  adoptRemoteMachineInventory([]);
  vi.unstubAllGlobals();
});

async function render() {
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
  };
}

const refuse = (environmentId: string) =>
  act(async () =>
    applyRemoteConnection(environmentId, { type: "failure", error: refusal, at: Date.now() }),
  );
const openNotifications = () =>
  act(async () => {
    document.body.querySelector<HTMLButtonElement>('button[aria-label="Notifications"]')!.click();
  });
const reconnectButton = () =>
  [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (button) => button.textContent === "Reconnect",
  );

it("tells the owner this computer's link was revoked and pairs again only on Reconnect", async () => {
  await render();
  await refuse("env-local");
  await openNotifications();
  expect(document.body.textContent).toContain(
    "This computer's connection to its Host was revoked.",
  );
  expect(host.reconnect).not.toHaveBeenCalled();

  await act(async () => reconnectButton()!.click());
  expect(host.reconnect).toHaveBeenCalledExactlyOnceWith({ machineId: "local" });
  // The Host answers again: the refusal state is cleared and the notice goes away.
  expect(document.body.textContent).not.toContain("was revoked");
});

it("keeps the notice and shows the reason when Reconnect fails", async () => {
  host.reconnect.mockRejectedValue(new Error("The local Host is not installed on this computer"));
  await render();
  await refuse("env-local");
  await openNotifications();
  await act(async () => reconnectButton()!.click());
  expect(document.body.textContent).toContain("was revoked");
  expect(document.body.textContent).toContain("The local Host is not installed on this computer");
});

it("never offers Reconnect for another machine's refusal", async () => {
  await render();
  await refuse("env-office");
  await openNotifications();
  expect(document.body.textContent).not.toContain("was revoked");
  expect(reconnectButton()).toBeUndefined();
});
