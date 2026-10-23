// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServersView } from "./ServersView";
import { ServerItem } from "./ServerItem";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import {
  disconnectMachine,
  requestMachineEdit,
  requestMachineReconnect,
  remoteRequest,
} from "../model/connections";
import { requestMachineAdd } from "../model/machineAdd";
import type { RemoteMachine } from "../model/protocol";
import {
  removeSshConnection,
  saveSshConnection,
  updateServerMetadata,
  type ServerRecord,
} from "../model/serverInventory";
import { applyRemoteConnection, resetRemoteHealth } from "../model/remoteHealth";
import { recordFeatureHealth } from "../model/remoteLifecycle";
import { reconnectRemoteMachine } from "../model/remoteReconnect";
import { resetServersLayoutForTests } from "./serversLayout";

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
  disconnectMachine: vi.fn(),
  knownRemoteMachine: (environmentId: string) =>
    fixture.machines.find((machine) => machine.environmentId === environmentId),
  remoteMachineFor: async (environmentId: string) =>
    fixture.machines.find((machine) => machine.environmentId === environmentId),
  remoteRequest: vi.fn(),
  recordRemoteCapabilities: vi.fn(),
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
  removeSshConnection: vi.fn(),
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
  resetServersLayoutForTests();
  resetRemoteHealth();
  vi.mocked(remoteRequest).mockResolvedValue({});
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

it("opens Termius migration from the Add menu", async () => {
  await render();
  await click("Add");
  const action = document.querySelector<HTMLButtonElement>(
    '[role="menuitem"][aria-label="Import from Termius"]',
  );
  expect(action).toBeTruthy();
  await act(async () => action!.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Scan this computer");
});

it("shows real recovery progress and keeps degraded features visible after Host recovery", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(remoteRequest).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await click("Home Mac");
  let recovery!: Promise<unknown>;
  await act(async () => {
    recovery = reconnectRemoteMachine(machine.environmentId);
  });
  expect(container.querySelector("[data-server-row]")?.textContent).toContain("Reconnecting");
  expect(container.querySelector('button[aria-label="Reconnect"]')?.getAttribute("aria-busy")).toBe(
    "true",
  );
  expect(container.querySelector('button[aria-label="Cancel reconnect"]')).toBeTruthy();
  await act(async () => {
    recordFeatureHealth(machine.environmentId, "files", false);
    finish({});
    await recovery;
  });
  expect(container.querySelector("[data-server-row]")?.textContent).toContain("Refresh pending");
  expect(container.querySelector('[aria-label="Server details"]')?.textContent).toContain(
    "Unavailable",
  );
  await act(async () => recordFeatureHealth(machine.environmentId, "files", true));
  expect(container.querySelector("[data-server-row]")?.textContent).toContain("Connected");
});

it("prevents double-click connection when the target cannot connect", async () => {
  const onConnect = vi.fn();
  await act(async () =>
    root.render(
      createElement(ServerItem, {
        server: {
          id: "offline",
          name: "Offline server",
          kind: "ssh",
          metadata: { tags: [], favorite: false },
        },
        address: "user@long-address.example.test:2222",
        layout: "cards",
        selected: true,
        canConnect: false,
        onSelect: vi.fn(),
        onConnect,
        onMenu: vi.fn(),
      }),
    ),
  );
  const row = container.querySelector<HTMLButtonElement>("[data-server-row]")!;
  await act(async () =>
    row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0, detail: 2 })),
  );
  expect(onConnect).not.toHaveBeenCalled();
  expect(row.querySelector('[title="user@long-address.example.test:2222"]')?.className).toContain(
    "whitespace-normal",
  );
});

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
  await click("Server actions");
  await act(async () => menuItem("Edit machine")!.click());
  expect(requestMachineEdit).toHaveBeenCalledWith("mac");
  await click("Reconnect");
  expect(remoteRequest).toHaveBeenCalledWith("mac", "environment.describe", {}, true);
  expect(requestMachineReconnect).not.toHaveBeenCalled();
  await click("Add");
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[role="menuitem"][aria-label="Add machine"]')!
      .click(),
  );
  expect(requestMachineAdd).toHaveBeenCalledOnce();
});

it("filters names and addresses and distinguishes no matches from an empty inventory", async () => {
  await render();
  await search("ME@HOME");
  expect(container.querySelectorAll("[data-server-row]")).toHaveLength(1);
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
  expect(container.querySelectorAll("[data-server-row]")).toHaveLength(1);
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
  expect(container.querySelector('[data-server-row][aria-pressed="true"]')?.textContent).toContain(
    "Home Mac",
  );
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
  expect(container.querySelector('[data-server-row][aria-pressed="true"]')).toBeTruthy();
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
  expect(container.querySelectorAll("[data-server-row]")).toHaveLength(1);
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
  await click("Server actions");
  await act(async () => menuItem("Edit SSH server")!.click());
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
  expect(container.querySelectorAll("[data-server-row]")).toHaveLength(1);
  expect(container.querySelector("li")?.textContent).toContain("Personal SSH");
  expect(container.querySelector('[aria-label="Server details"]')?.textContent).toContain(
    "Home Mac",
  );
  const reset = [...popover.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Reset filters"),
  )!;
  await act(async () => reset.click());
  expect(container.querySelectorAll("[data-server-row]")).toHaveLength(2);
  expect(container.querySelector('[data-server-row][aria-pressed="true"]')?.textContent).toContain(
    "Home Mac",
  );
});

it("searches and displays the effective SSH destination while preserving the editable base", async () => {
  const server: ServerRecord = {
    id: "inherited-destination",
    name: "Inherited destination",
    kind: "ssh",
    sshEndpoint: { host: "target.invalid", user: "local-user", port: 22 },
    effectiveSshEndpoint: { host: "target.invalid", user: "group-user", port: 2200 },
    metadata: { tags: [], favorite: false },
  };
  fixture.extraServers = [server];
  terminalActions.open = vi.fn();
  await render();
  await search("group-user");
  expect(container.querySelectorAll("[data-server-row]")).toHaveLength(1);
  await click("Inherited destination");
  const details = container.querySelector('[aria-label="Server details"]')!;
  expect(details.textContent).toContain("group-user@target.invalid");
  expect(details.textContent).toContain("2200");
  expect(server.sshEndpoint).toEqual({ host: "target.invalid", user: "local-user", port: 22 });
  expect(terminalActions.open).not.toHaveBeenCalled();
});

const rowFor = (id: string) =>
  container.querySelector<HTMLButtonElement>(`[data-server-row="${id}"]`)!;
const menuItem = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
    item.textContent?.includes(label),
  );
const openRowMenu = async (id: string) => {
  await act(async () =>
    rowFor(id).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }),
    ),
  );
  expect(menuItem("Show details")).toBeTruthy();
};
/** ConfirmMorph ignores an answer within ~280 ms of the question being asked. */
const settleQuestion = () => act(async () => new Promise((resolve) => setTimeout(resolve, 320)));
const clickInDocument = async (label: string, scope: ParentNode = document) => {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent?.includes(label) || entry.getAttribute("aria-label") === label,
  );
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
};

it("opens the server context menu on right click with the expected actions", async () => {
  terminalActions.open = vi.fn();
  fixture.extraServers = [sshServer];
  await render();
  await openRowMenu("ssh-stable");
  for (const label of [
    "Connect",
    "Show details",
    "Edit SSH server",
    "Unfavorite",
    "Color…",
    "Copy address",
    "Delete",
  ]) {
    expect(menuItem(label), label).toBeTruthy();
  }
  await act(async () => menuItem("Show details")!.click());
  expect(container.querySelector('[aria-label="Server details"]')?.textContent).toContain(
    "Personal SSH",
  );
  expect(document.querySelector('[role="menu"], [role="menuitem"]')).toBeNull();
});

it("offers Connect only for servers that can open a terminal and reaches the menu from the keyboard", async () => {
  terminalActions.open = undefined;
  await render();
  await act(async () =>
    rowFor("mac").dispatchEvent(
      new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }),
    ),
  );
  expect(menuItem("Show details")).toBeTruthy();
  expect(menuItem("Connect")).toBeUndefined();
  expect(menuItem("Edit machine")).toBeTruthy();
});

it("opens the same menu from the details overflow and edits a host machine through the existing flow", async () => {
  await render();
  await click("Home Mac");
  await click("Server actions");
  expect(menuItem("Edit machine")).toBeTruthy();
  await act(async () => menuItem("Edit machine")!.click());
  expect(requestMachineEdit).toHaveBeenCalledWith("mac");
});

it("copies the address and toggles the favorite flag from the context menu", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  fixture.extraServers = [sshServer];
  await render();
  await openRowMenu("ssh-stable");
  await act(async () => menuItem("Copy address")!.click());
  expect(writeText).toHaveBeenCalledWith("alice@remote.example");
  await openRowMenu("ssh-stable");
  await act(async () => menuItem("Unfavorite")!.click());
  expect(updateServerMetadata).toHaveBeenCalledWith("ssh-stable", { favorite: false });
  vi.unstubAllGlobals();
});

it("deletes an SSH server only after confirmation and clears the selection it held", async () => {
  fixture.extraServers = [sshServer];
  vi.mocked(removeSshConnection).mockResolvedValue(undefined);
  await render();
  await click("Personal SSH");
  await openRowMenu("ssh-stable");
  await act(async () => menuItem("Delete")!.click());
  const question = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Delete Personal SSH?"]',
  )!;
  expect(question).toBeTruthy();
  expect(removeSshConnection).not.toHaveBeenCalled();
  await clickInDocument("Delete", question);
  await settleQuestion();
  expect(removeSshConnection).not.toHaveBeenCalled();
  await clickInDocument("Confirm delete", question);
  expect(removeSshConnection).toHaveBeenCalledExactlyOnceWith("ssh-stable");
  expect(container.querySelector('[aria-label="Server details"]')).toBeNull();
});

it("reports a failed delete inline and keeps the server selected", async () => {
  fixture.extraServers = [sshServer];
  vi.mocked(removeSshConnection).mockRejectedValueOnce(new Error("database locked"));
  await render();
  await click("Personal SSH");
  await openRowMenu("ssh-stable");
  await act(async () => menuItem("Delete")!.click());
  const question = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Delete Personal SSH?"]',
  )!;
  await clickInDocument("Delete", question);
  await settleQuestion();
  await clickInDocument("Confirm delete", question);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("database locked");
  expect(container.querySelector('[aria-label="Server details"]')?.textContent).toContain(
    "Personal SSH",
  );
});

it("removes a host machine from this desktop through the existing disconnect path", async () => {
  await render();
  await openRowMenu("mac");
  await act(async () => menuItem("Delete")!.click());
  const question = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Delete Home Mac?"]',
  )!;
  expect(question.textContent).toContain("this desktop only");
  await clickInDocument("Delete", question);
  await settleQuestion();
  await clickInDocument("Confirm delete", question);
  expect(disconnectMachine).toHaveBeenCalledExactlyOnceWith("mac");
  expect(removeSshConnection).not.toHaveBeenCalled();
});

it("sets and clears a server color through palette swatches", async () => {
  fixture.extraServers = [{ ...sshServer, metadata: { ...sshServer.metadata, colorIndex: 2 } }];
  await render();
  await openRowMenu("ssh-stable");
  await act(async () => menuItem("Color…")!.click());
  const popover = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Server color"]',
  )!;
  expect(popover).toBeTruthy();
  await act(async () =>
    popover.querySelector<HTMLButtonElement>('[aria-label="Color 4"]')!.click(),
  );
  expect(updateServerMetadata).toHaveBeenLastCalledWith("ssh-stable", {
    colorIndex: 3,
    customColor: null,
  });
  await clickInDocument("No color", popover);
  expect(updateServerMetadata).toHaveBeenLastCalledWith("ssh-stable", {
    colorIndex: null,
    customColor: null,
  });
});

it("saves a custom color once after edits settle and flushes on dismiss", async () => {
  fixture.extraServers = [sshServer];
  await render();
  await openRowMenu("ssh-stable");
  await act(async () => menuItem("Color…")!.click());
  const popover = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Server color"]',
  )!;
  await act(async () =>
    popover.querySelector<HTMLButtonElement>('[aria-label="Custom color"]')!.click(),
  );
  const hex = document.querySelector<HTMLInputElement>('input[aria-label="Hex color"]')!;
  const type = (value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(hex, value);
    hex.dispatchEvent(new Event("input", { bubbles: true }));
  };
  vi.useFakeTimers();
  try {
    updateServerMetadata.mockClear();
    act(() => type("#112233"));
    act(() => type("#445566"));
    expect(updateServerMetadata).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(250));
    expect(updateServerMetadata).toHaveBeenCalledExactlyOnceWith("ssh-stable", {
      customColor: "#445566",
    });
    act(() => type("#778899"));
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    act(() => vi.advanceTimersByTime(0));
  } finally {
    vi.useRealTimers();
  }
  expect(updateServerMetadata).toHaveBeenLastCalledWith("ssh-stable", { customColor: "#778899" });
});

it("switches between list and card layouts and remembers the choice", async () => {
  await render();
  const layout = () =>
    container.querySelector("[data-servers-layout]")?.getAttribute("data-servers-layout");
  expect(layout()).toBe("list");
  await click("Card view");
  expect(layout()).toBe("cards");
  expect(container.querySelector('[aria-label="Card view"]')?.getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(localStorage.getItem("bycoda.servers.layout")).toBe("cards");
  await act(async () => root.render(null));
  await render();
  expect(layout()).toBe("cards");
  await click("List view");
  expect(layout()).toBe("list");
  expect(rowFor("mac").textContent).toContain("Home Mac");
});
