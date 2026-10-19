// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServersView } from "./ServersView";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import { requestMachineEdit, requestMachineReconnect } from "../model/connections";
import { requestMachineAdd } from "../model/machineAdd";
import type { RemoteMachine } from "../model/protocol";
import {
  saveSshConnection,
  updateServerMetadata,
  type ServerRecord,
} from "../model/serverInventory";
import { applyRemoteConnection } from "../model/remoteHealth";

vi.mock("./ServersConnectionTools", async () => {
  const { ServerOrganization } = await import("./ServerOrganization");
  return {
    ServersConnectionTools: ({ server }: { server: ServerRecord }) =>
      createElement(ServerOrganization, { server }),
  };
});

const fixture = vi.hoisted(() => ({
  machines: [] as RemoteMachine[],
  extraServers: [] as ServerRecord[],
  loaded: true,
  loading: false,
  error: undefined as string | undefined,
  refresh: vi.fn(),
}));
const terminalActions = vi.hoisted(() => ({
  open: undefined as ReturnType<typeof vi.fn> | undefined,
}));
vi.mock("./ServersTerminalWorkspace", () => ({
  useOpenServerTerminal: () => terminalActions.open,
  useOpenQuickServerTerminal: () => undefined,
}));
vi.mock("../model/connections", () => ({
  useRemoteMachines: () => fixture,
  useRemoteMachineOnline: () => undefined,
  requestMachineEdit: vi.fn(),
  requestMachineReconnect: vi.fn(),
}));
vi.mock("../model/serverInventory", () => ({
  useServerInventory: () => ({
    ...fixture,
    servers: [
      ...fixture.machines.map((machine) => ({
        id: machine.id,
        name: machine.name,
        kind: "host",
        machine,
        metadata: { tags: [], favorite: false },
      })),
      ...fixture.extraServers,
    ],
  }),
  saveSshConnection: vi.fn(),
  updateServerMetadata: vi.fn(),
}));
vi.mock("../model/machineAdd", () => ({ requestMachineAdd: vi.fn() }));
vi.mock("../../../app/shell/ToolNavigation", () => ({
  ToolHeader: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../../app/shell/TitleBar", () => ({ OverlayNav: () => null }));
vi.mock("../../../app/shell/WindowControls", () => ({ WindowControls: () => null }));

let container: HTMLDivElement;
let root: Root;
const machine: RemoteMachine = {
  id: "mac",
  name: "Home Mac",
  environmentId: "mac-env",
  endpoint: "ssh://me@home",
  ssh: { target: "me@home", remotePort: 3774, port: 2222 },
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  resetRetainedState();
  terminalActions.open = undefined;
  fixture.extraServers = [];
  Object.assign(fixture, { machines: [machine], loaded: true, loading: false, error: undefined });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = async () => {
  await act(async () => root.render(createElement(ServersView)));
};
const click = async (label: string) => {
  const button = [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent?.includes(label) || entry.getAttribute("aria-label") === label,
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
};
const search = async (value: string) => {
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

it("selects on a single click and opens the canonical SSH record once on double click", async () => {
  terminalActions.open = vi.fn();
  await render();
  const row = container.querySelector<HTMLButtonElement>("[data-server-row]")!;
  await act(async () => row.click());
  expect(terminalActions.open).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-label="Server details"]')).toBeTruthy();
  await act(async () =>
    row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0, detail: 2 })),
  );
  expect(terminalActions.open).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ id: "mac", machine }),
  );
});

it("connects with Enter without repeating the connection and closes details back to the row", async () => {
  terminalActions.open = vi.fn();
  await render();
  const row = container.querySelector<HTMLButtonElement>("[data-server-row]")!;
  await act(async () => {
    row.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    row.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true }),
    );
  });
  expect(terminalActions.open).toHaveBeenCalledOnce();
  await click("Close server details");
  expect(container.querySelector('[aria-label="Server details"]')).toBeNull();
  expect(document.activeElement).toBe(row);
});

it("does not launch SSH for a Host record with no SSH endpoint", async () => {
  terminalActions.open = vi.fn();
  fixture.machines = [{ ...machine, ssh: undefined, endpoint: "http://127.0.0.1:3776" }];
  await render();
  const row = container.querySelector<HTMLButtonElement>("[data-server-row]")!;
  await act(async () =>
    row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0, detail: 2 })),
  );
  expect(terminalActions.open).not.toHaveBeenCalled();
  expect(row.hasAttribute("aria-keyshortcuts")).toBe(false);
});

it("selects canonical machines and delegates add, edit and reconnect to existing flows", async () => {
  await render();
  await click("Home Mac");
  const details = container.querySelector('[aria-label="Server details"]')!;
  expect(details.textContent).toContain("2222");
  expect(details.textContent).toContain("3774");
  await click("Edit machine");
  expect(requestMachineEdit).toHaveBeenCalledWith("mac");
  await click("Reconnect");
  expect(requestMachineReconnect).toHaveBeenCalledWith("mac");
  await click("Add machine");
  expect(requestMachineAdd).toHaveBeenCalledOnce();
});

it("filters names and addresses and distinguishes no matches from an empty inventory", async () => {
  await render();
  await search("ME@HOME");
  expect(container.querySelectorAll("li")).toHaveLength(1);
  await search("absent");
  expect(container.textContent).toContain("No matching servers.");
  expect(container.textContent).not.toContain("No machines connected.");
  fixture.machines = [];
  await render();
  expect(container.textContent).toContain("No machines connected.");
});

it("keeps the last list and selection visible when refresh fails and allows retry", async () => {
  await render();
  await click("Home Mac");
  fixture.error = "database unavailable";
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Showing last loaded data",
  );
  expect(container.querySelectorAll("li")).toHaveLength(1);
  expect(container.querySelector('[aria-label="Server details"]')).toBeTruthy();
  await click("Retry");
  expect(fixture.refresh).toHaveBeenCalledOnce();
});

it("separates initial loading and load failure from an empty successful inventory", async () => {
  Object.assign(fixture, { machines: [], loaded: false, loading: true });
  await render();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Loading servers");
  expect(container.textContent).not.toContain("No machines connected.");
  Object.assign(fixture, { loading: false, error: "unavailable" });
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Couldn’t load servers");
  expect(container.textContent).not.toContain("No machines connected.");
});

it("restores search, selection and scroll after navigating away and returning", async () => {
  await render();
  await search("Home");
  await click("Home Mac");
  const scroller = container.querySelector(".overflow-y-auto")!;
  scroller.scrollTop = 90;
  await act(async () => scroller.dispatchEvent(new Event("scroll", { bubbles: true })));
  await act(async () => root.render(null));
  await render();
  expect(container.querySelector("input")?.value).toBe("Home");
  expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain("Home Mac");
  expect(container.querySelector(".overflow-y-auto")?.scrollTop).toBe(90);
});

it("does not expose credentials from a URL endpoint", async () => {
  fixture.machines = [
    {
      id: "url",
      name: "URL host",
      environmentId: "url-env",
      endpoint: "https://owner:private@example.test:3774/rpc?token=secret",
    },
  ];
  await render();
  await click("URL host");
  expect(container.textContent).toContain("https://example.test:3774");
  expect(container.textContent).not.toContain("private");
  expect(container.textContent).not.toContain("secret");
});

it("updates the machine's status from shared host health without losing inventory", async () => {
  applyRemoteConnection(machine.environmentId, { type: "ok", at: 1 });
  await render();
  expect(container.querySelector("li")?.textContent).toContain("Connected");
  await act(async () =>
    applyRemoteConnection(machine.environmentId, {
      type: "failure",
      error: "Machine is unreachable",
      at: 2,
    }),
  );
  expect(container.querySelector("li")?.textContent).toContain("Not connected");
  expect(container.querySelector("li")?.textContent).toContain("Home Mac");
  expect(container.querySelector("li")?.textContent).not.toContain("The machine did not answer");
  await click("Home Mac");
  const disclosure = container.querySelector(
    '[aria-label="Server details"] details',
  ) as HTMLDetailsElement;
  expect(disclosure).toBeTruthy();
  expect(disclosure.open).toBe(false);
  expect(disclosure.textContent).toContain("The machine did not answer");
  await act(async () => {
    disclosure.open = true;
  });
  expect(disclosure.open).toBe(true);
  expect(container.querySelector('[aria-pressed="true"]')).toBeTruthy();
});

const sshServer: ServerRecord = {
  id: "ssh-stable",
  name: "Personal SSH",
  kind: "ssh",
  sshEndpoint: { host: "remote.example", user: "alice", port: 2200 },
  metadata: { group: "Personal", tags: ["linux"], favorite: true },
};
it("lists SSH-only endpoints without calling host health or offering host installation", async () => {
  fixture.extraServers = [sshServer];
  await render();
  await search("linux");
  expect(container.querySelectorAll("li")).toHaveLength(1);
  await click("Personal SSH");
  const details = container.querySelector('[aria-label="Server details"]')!;
  expect(details.textContent).toContain("alice@remote.example");
  expect(details.textContent).toContain("2200");
  expect(details.textContent).not.toContain("Host service port");
  expect(details.textContent).not.toContain("Reconnect");
  expect(requestMachineReconnect).not.toHaveBeenCalled();
});

it("edits an SSH-only endpoint with stable canonical ID and no password field", async () => {
  fixture.extraServers = [sshServer];
  vi.mocked(saveSshConnection).mockResolvedValue(sshServer);
  await render();
  await click("Personal SSH");
  await click("Edit SSH server");
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).toBeTruthy();
  expect(dialog.querySelectorAll('input[type="password"]')).toHaveLength(0);
  await act(async () =>
    dialog
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(saveSshConnection).toHaveBeenCalledWith({
    id: "ssh-stable",
    name: "Personal SSH",
    endpoint: {
      host: "remote.example",
      user: "alice",
      port: 2200,
      identityFile: undefined,
      jumpHost: undefined,
    },
  });
});

it("patches only owned organization fields, leaving last-use and forwards native-owned", async () => {
  fixture.extraServers = [{ ...sshServer, metadata: { ...sshServer.metadata, lastUsedAt: 123 } }];
  await render();
  await click("Personal SSH");
  const form = container.querySelector("details form")!;
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(updateServerMetadata).toHaveBeenCalledWith("ssh-stable", {
    group: "Personal",
    tags: ["linux"],
    favorite: true,
  });
});

it("explicitly clears a saved group instead of omitting the patch field", async () => {
  fixture.extraServers = [sshServer];
  await render();
  await click("Personal SSH");
  const form = container.querySelector("details form")!;
  const input = form.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(updateServerMetadata).toHaveBeenCalledWith("ssh-stable", {
    group: "",
    tags: ["linux"],
    favorite: true,
  });
});

it("filters favorites without clearing hidden selection and resets inside the popover", async () => {
  fixture.extraServers = [sshServer];
  await render();
  await click("Home Mac");
  await click("Server filters");
  const popover = document.querySelector('[role="dialog"][aria-label="Server filters"]')!;
  const favorites = popover.querySelector(
    '[role="switch"][aria-label="Favorites only"]',
  ) as HTMLButtonElement;
  await act(async () => favorites.click());
  expect(container.querySelectorAll("li")).toHaveLength(1);
  expect(container.querySelector("li")?.textContent).toContain("Personal SSH");
  expect(container.querySelector('[aria-label="Server details"]')?.textContent).toContain(
    "Home Mac",
  );
  const reset = [...popover.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Reset filters"),
  )!;
  await act(async () => reset.click());
  expect(container.querySelectorAll("li")).toHaveLength(2);
  expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain("Home Mac");
});
