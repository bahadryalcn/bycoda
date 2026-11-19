// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { RevealedSetting } from "../../settings/public/ConnectionRecoverySettings";
import { requestMachineAdd } from "../model/machineAdd";
import { registerAppConfirmHost } from "../../../shared/model/appConfirm";
import { useSyncStatus } from "../../sync/model/useSyncStatus";
import { REMOTE_PROVIDERS, type RemoteMachine, type SshSetup } from "../model/protocol";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));
// Connection setup fixtures contain no persisted commands; outbox recovery has
// separate durable-storage coverage.
vi.mock("../model/remoteOutbox", async (original) => ({
  ...(await original<typeof import("../model/remoteOutbox")>()),
  useDurableRemoteOutboxIssues: () => [],
}));
vi.mock("../../sync/model/useSyncStatus", () => ({ useSyncStatus: vi.fn() }));
let container: HTMLDivElement;
let root: Root;
let state: SshSetup;
let machines: RemoteMachine[];
let stopConfirm: () => void;
const approveUpdate = vi.fn(async () => true);
const machine: RemoteMachine = {
  id: "machine",
  name: "Home Mac",
  environmentId: "env",
  endpoint: "ssh://me@home",
  ssh: { target: "me@home", remotePort: 3774 },
};
beforeEach(() => {
  approveUpdate.mockResolvedValue(true);
  approveUpdate.mockClear();
  stopConfirm = registerAppConfirmHost(approveUpdate);
  vi.mocked(useSyncStatus).mockReturnValue({ state: "idle", pendingOps: 0 });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  machines = [];
  state = { id: "setup", message: "Installing host…", done: false };
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "remote_machines") return [...machines];
    if (command === "remote_ssh_begin" || command === "remote_ssh_reconnect") return "setup";
    if (command === "remote_machine_update") {
      const edit = args as {
        name: string;
        target: string;
        port: number | null;
        remotePort?: number;
      };
      const saved = {
        ...machine,
        name: edit.name || machine.name,
        endpoint: `ssh://${edit.target}`,
        ssh: { target: edit.target, port: edit.port, remotePort: edit.remotePort ?? 3774 },
      };
      machines = [saved];
      return saved;
    }
    if (command === "remote_ssh_poll") return { ...state };
    if (command === "remote_request") {
      const method = (args as { method: string }).method;
      // The Devices tab reads these; answer them like a current Host would.
      if (method === "devices.paired" || method === "host.access.read")
        return { devices: [{ id: "self", name: "Home Mac", isCurrent: true }] };
      if (method === "mobile.access.status") return { enabled: false };
      return { environmentId: "env", providers: ["codex"] };
    }
    if (command === "remote_disconnect") {
      machines = [];
      return;
    }
    if (command === "remote_ssh_cancel" || command === "remote_ssh_answer") return;
    throw new Error(`Unexpected command ${command}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  stopConfirm();
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const button = (name: string) =>
  // The add dialog renders in a portal on document.body, so search the whole document.
  [...document.querySelectorAll("button")].find((button) => {
    const copy = button.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
    return copy.textContent?.trim() === name;
  })!;
const SSH_TARGET = 'input[placeholder="user@my-mac-mini or an SSH alias"]';
const tabNamed = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (item) => item.textContent === name,
  )!;
// Opens the add dialog and lands on its "Enter address" tab (it opens on "Found" without a draft).
async function openAdvanced() {
  await act(async () => button("Add a computer").click());
  if (!document.querySelector(SSH_TARGET) && !document.querySelector('input[type="url"]'))
    await act(async () => tabNamed("Enter address").click());
}
const confirmRemove = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].at(-1)!;
async function pick(machineName: string, label: string) {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${machineName}"]`)!
      .click(),
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>(`[role="menuitem"][aria-label="${label}"]`)!.click(),
  );
}
const editMachine = (name: string) => pick(name, "Edit name and address…");
async function render() {
  await act(async () => root.render(createElement(ConnectionsSettings)));
}

it("reveals Devices, Sharing and recovery from any nested tab while preserving manual tab choice", async () => {
  for (const start of ["Computers", "Devices", "Sharing"]) {
    await render();
    const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (item) => item.textContent === start,
    )!;
    await act(async () => tab.click());
    for (const [id, title] of [
      ["connections-phone", "Devices"],
      ["connections-sharing", "Sharing"],
      ["remote-auto-reconnect", "Computers"],
    ]) {
      await act(async () =>
        root.render(
          createElement(
            RevealedSetting.Provider,
            { value: id },
            createElement(ConnectionsSettings),
          ),
        ),
      );
      expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
        title,
      );
      if (id !== "remote-auto-reconnect")
        expect(
          container.querySelector(`[data-setting-id="${id}"]`)?.closest("[hidden]"),
        ).toBeNull();
    }
  }
});

it("shows a failed sync as one inline message with a retry", async () => {
  machines = [machine];
  vi.mocked(useSyncStatus).mockReturnValue({
    state: "error",
    lastError: "RPC_HOST_UNAVAILABLE: connection closed; reconnect before retrying",
    pendingOps: 2,
  });
  await render();
  const line = container.querySelector(".connection-sync")!;
  expect(line.getAttribute("data-sync-tone")).toBe("warning");
  expect(line.querySelector("details")).toBeNull();
  expect(line.textContent).toContain("Sync is paused");
  expect(container.querySelector('button[aria-haspopup="menu"]')).toBeTruthy();
});

it("labels the kind and icon of each machine row", async () => {
  machines = [
    machine,
    { id: "url", name: "Lab", environmentId: "env-url", endpoint: "https://lab.example.com" },
  ];
  await render();
  const rows = [...container.querySelectorAll<HTMLElement>("div.flex-wrap.items-start")];
  const ssh = rows.find((row) => row.textContent?.includes("Home Mac"))!;
  const direct = rows.find((row) => row.textContent?.includes("Lab"))!;
  expect(ssh.textContent).toContain("SSH");
  expect(ssh.textContent).not.toContain("Remote computer");
  expect(ssh.querySelector("svg.lucide-server")).toBeTruthy();
  expect(direct.textContent).toContain("Host URL");
  expect(direct.querySelector("svg.lucide-server")).toBeTruthy();
  expect(container.textContent).toContain("Your computers");
  // The meta parts are spaced items, not "·"-separated text.
  expect(ssh.textContent).not.toContain("Host URL ·");
});

it("opens the add dialog for a Servers request made before Settings mounts", async () => {
  requestMachineAdd();
  await render();
  expect(document.querySelector('section[aria-label="Available to add"]')).toBeTruthy();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Add a computer");
  expect(document.querySelector(SSH_TARGET)).toBeNull();
  expect(requested("remote_ssh_begin")).toBe(false);
});

it("shows search only for long lists and keeps the add button primary", async () => {
  machines = [machine];
  await render();
  expect(container.querySelector('input[aria-label="Search computers"]')).toBeNull();
  expect(button("Add a computer")).toBeTruthy();
  machines = Array.from({ length: 6 }, (_, index) => ({
    ...machine,
    id: `m${index}`,
    name: `Box ${index}`,
    environmentId: `env${index}`,
  }));
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!.click(),
  );
  expect(container.querySelector('input[aria-label="Search computers"]')).toBeTruthy();
});

it("keeps a machine draft when moving between connection views", async () => {
  await render();
  await openAdvanced();
  await fill(SSH_TARGET, "me@new-host");
  const choose = (value: string) =>
    container.querySelector<HTMLButtonElement>(`[role="tab"][data-tab-value="${value}"]`)!;
  await act(async () => choose("phone").click());
  expect(container.querySelector(".connections-view:not([hidden])")?.textContent).toContain(
    "Connect a phone",
  );
  await act(async () => choose("machines").click());
  // The dialog returns on the typed address.
  expect(document.querySelector<HTMLInputElement>(SSH_TARGET)?.value).toBe("me@new-host");
  expect(requested("remote_ssh_begin")).toBe(false);
});

it("no longer renders a separate URL disclosure", async () => {
  await render();
  expect(container.querySelector("details.connection-disclosure")).toBeNull();
  expect(container.textContent).not.toContain("Connect to an existing host by URL");
  expect(document.querySelector('input[type="url"]')).toBeNull();
});
async function fill(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("closes the add dialog when SSH setup starts and locks the method while a URL connect is pending", async () => {
  await render();
  await openAdvanced();
  await fill(SSH_TARGET, "owner@fixture");
  await act(async () => button("Connect").click());
  // Progress shows on the page, not in the dialog.
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector('[role="status"]')).toBeTruthy();
  await act(async () => button("Stop").click());
  state = { ...state, done: true, error: "Connection cancelled" };
  await poll();
  await openAdvanced();
  await chooseMethod("Host URL");
  await fill('input[type="url"]', "https://pending.example");
  await fill('input[type="password"]', "device-token");
  const previous = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "remote_connect") return new Promise(() => undefined);
    return previous(command, args);
  });
  await act(async () => button("Connect").click());
  const methods = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  expect(methods.length).toBeGreaterThan(0);
  expect(methods.every((item) => item.disabled)).toBe(true);
});

it("keeps Add SSH fields through method switches, cancel and editing another machine", async () => {
  machines = [machine];
  await render();
  const target = 'input[placeholder="user@my-mac-mini or an SSH alias"]';
  await openAdvanced();
  await fill(target, "owner@new-computer");
  await chooseMethod("Host URL");
  await fill('input[type="url"]', "https://new-computer.example");
  await chooseMethod("SSH");
  expect(document.querySelector<HTMLInputElement>(target)?.value).toBe("owner@new-computer");
  await act(async () => button("Cancel").click());
  await editMachine("Home Mac");
  expect(document.querySelector<HTMLInputElement>(target)?.value).toBe("me@home");
  await fill(target, "owner@edited-computer");
  await act(async () => button("Cancel").click());
  await openAdvanced();
  expect(document.querySelector<HTMLInputElement>(target)?.value).toBe("owner@new-computer");
  await chooseMethod("Host URL");
  expect(document.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe(
    "https://new-computer.example",
  );
  expect(requested("remote_ssh_begin")).toBe(false);
  expect(requested("remote_machine_update")).toBe(false);
});
async function start() {
  await render();
  await openAdvanced();
  await fill(SSH_TARGET, "me@home");
  await act(async () => button("Connect").click());
}
async function poll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

const chooseMethod = (label: string) =>
  act(async () =>
    document
      .querySelector<HTMLElement>(
        `input[type="radio"][value="${label === "SSH" ? "ssh" : "url"}"]`,
      )!
      .click(),
  );

it("keeps the URL and token drafts across method switches and a failed connect", async () => {
  await render();
  await openAdvanced();
  await chooseMethod("Host URL");
  await fill('input[type="url"]', "https://remote.example.com");
  await fill('input[type="password"]', "device-token");
  const credential = document.querySelector<HTMLInputElement>('input[type="password"]')!;
  credential.focus();
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('button[aria-controls="' + credential.id + '"]')!
      .click(),
  );
  expect(credential.type).toBe("text");
  expect(credential.value).toBe("device-token");
  expect(document.activeElement).toBe(credential);
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('button[aria-controls="' + credential.id + '"]')!
      .click(),
  );
  expect(credential.type).toBe("password");
  // Switching the method back and forth, and closing the form, keeps the drafts.
  await chooseMethod("SSH");
  expect(document.querySelector('input[type="url"]')).toBeNull();
  await chooseMethod("Host URL");
  await act(async () => button("Cancel").click());
  await openAdvanced();
  // A reopened form starts on SSH again; the URL drafts wait behind the method switch.
  expect(document.querySelector('input[type="url"]')).toBeNull();
  await chooseMethod("Host URL");
  expect(document.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe(
    "https://remote.example.com",
  );
  expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe(
    "device-token",
  );
  expect(requested("remote_connect")).toBe(false);
  const previous = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "remote_connect") throw new Error("Host unavailable");
    return previous(command, args);
  });
  await act(async () => button("Connect").click());
  expect(document.querySelector('form[aria-label="Add a new computer"]')).toBeTruthy();
  expect(document.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe(
    "https://remote.example.com",
  );
  expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe(
    "device-token",
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Host unavailable");
  expect(button("Connect").disabled).toBe(false);
});

it("connects an existing host by URL from the add form and closes it on success", async () => {
  const previous = vi.mocked(invoke).getMockImplementation()!;
  const connected: RemoteMachine = {
    id: "url",
    name: "Lab",
    environmentId: "env-url",
    endpoint: "https://remote.example.com",
  };
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "remote_connect") {
      machines = [connected];
      return connected;
    }
    return previous(command, args);
  });
  await render();
  await openAdvanced();
  expect(document.querySelector('input[type="url"]')).toBeNull();
  await chooseMethod("Host URL");
  expect(document.body.textContent).toContain(
    "Enter the host URL and a device token issued by that host.",
  );
  expect(document.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe(
    "http://127.0.0.1:3776",
  );
  await fill('input[type="url"]', "https://remote.example.com");
  await fill('input[type="password"]', "device-token");
  await act(async () => button("Connect").click());
  expect(invoke).toHaveBeenCalledWith(
    "remote_connect",
    expect.objectContaining({ token: "device-token" }),
  );
  expect(document.querySelector("form")).toBeNull();
  expect(container.textContent).toContain("Lab is connected.");
});

it("starts SSH setup from Settings and makes the machine available after native pairing", async () => {
  await start();
  expect(invoke).toHaveBeenCalledWith("remote_ssh_begin", {
    target: "me@home",
    name: "",
    port: null,
    alternate: null,
  });
  expect(container.textContent).toContain("Installing host…");
  machines = [machine];
  state = { ...state, done: true, machine };
  await poll();
  expect(container.textContent).toContain("Home Mac is connected");
  expect(container.textContent).toContain("SSH · me@home");
  expect(document.querySelector(SSH_TARGET)).toBeNull();
  await openAdvanced();
  expect(
    document.querySelector<HTMLInputElement>(
      'input[placeholder="user@my-mac-mini or an SSH alias"]',
    )?.value,
  ).toBe("");
});

it("requires an explicit host trust answer and forwards secrets only to the native prompt", async () => {
  state.prompt = {
    id: "trust",
    message: "Host fingerprint: SHA256:example",
    confirm: true,
  };
  await start();
  expect(invoke).not.toHaveBeenCalledWith("remote_ssh_answer", expect.anything());
  await act(async () => button("Trust host and continue").click());
  expect(invoke).toHaveBeenCalledWith("remote_ssh_answer", {
    jobId: "setup",
    promptId: "trust",
    answer: "yes",
  });
  state = {
    ...state,
    prompt: { id: "password", message: "Password:", confirm: false },
  };
  await poll();
  await fill('input[aria-label="SSH password or passphrase"]', "secret-for-this-prompt");
  await act(async () => button("Continue").click());
  expect(invoke).toHaveBeenCalledWith("remote_ssh_answer", {
    jobId: "setup",
    promptId: "password",
    answer: "secret-for-this-prompt",
  });
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="SSH password or passphrase"]')!
      .value,
  ).toBe("");
});

it("keeps the SSH address after a failed install and cancels active setup when Settings closes", async () => {
  state = { ...state, done: true, error: "Host package is unavailable" };
  await start();
  expect(container.textContent).toContain("Host package is unavailable");
  // The dialog closed when setup started; the typed address is kept for the next open.
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await openAdvanced();
  expect(document.querySelector<HTMLInputElement>(SSH_TARGET)!.value).toBe("me@home");
  state = { id: "setup", message: "Connecting…", done: false };
  await act(async () => button("Connect").click());
  await act(async () => root.unmount());
  root = createRoot(container);
  expect(invoke).toHaveBeenCalledWith("remote_ssh_cancel", { jobId: "setup" });
});

/** Makes the next `count` status reads fail with `message`; other commands keep their mock. */
function failPolls(count: number, message: string) {
  const normal = vi.mocked(invoke).getMockImplementation()!;
  let left = count;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "remote_ssh_poll" && left > 0) {
      left -= 1;
      throw new Error(message);
    }
    return normal(command, args);
  });
}

it("keeps an SSH setup alive through transient status failures and finishes normally", async () => {
  await start();
  failPolls(3, "ipc hiccup");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6_000);
  });
  expect(invoke).not.toHaveBeenCalledWith("remote_ssh_cancel", expect.anything());
  expect(container.textContent).not.toContain("ipc hiccup");
  machines = [machine];
  state = { ...state, done: true, machine };
  await poll();
  expect(container.textContent).toContain("Home Mac is connected");
  expect(invoke).not.toHaveBeenCalledWith("remote_ssh_cancel", expect.anything());
});

it("cancels and reports an SSH setup whose status stays unreachable", async () => {
  await start();
  failPolls(Infinity, "ipc hiccup");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });
  expect(invoke).toHaveBeenCalledWith("remote_ssh_cancel", { jobId: "setup" });
  expect(container.textContent).toContain("ipc hiccup");
});

it("drops an SSH setup the native side no longer knows without retrying", async () => {
  await start();
  failPolls(Infinity, "Connection setup has expired");
  await poll();
  expect(container.textContent).toContain("Connection setup has expired");
  expect(invoke).toHaveBeenCalledWith("remote_ssh_cancel", { jobId: "setup" });
});

async function chooseRevoke() {
  const radio = document.querySelector<HTMLInputElement>(
    '[role="dialog"] input[type="radio"][value="revoke"]',
  )!;
  await act(async () => radio.click());
}
async function openRemove() {
  machines = [machine];
  await render();
  await pick("Home Mac", "Remove connection…");
}

it("offers an explicit host update for an SSH machine missing workspace methods", async () => {
  machines = [machine];
  await render();
  expect(container.querySelector("[data-machine-summary]")?.textContent).toContain(
    "Update required",
  );
  await act(async () => button("Update Host").click());
  expect(approveUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Update Host on Home Mac?",
      tone: "danger",
      body: expect.anything(),
    }),
  );
  expect(invoke).toHaveBeenCalledWith("remote_ssh_reconnect", {
    machineId: machine.id,
    upgrade: true,
  });
});

it("turns a machine off without deleting its connection and keeps Remove in the menu", async () => {
  localStorage.removeItem("bycoda.disabledMachines");
  machines = [machine];
  await render();
  const toggle = container.querySelector(
    '[role="switch"][aria-label="Use Home Mac"]',
  ) as HTMLElement;
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  vi.mocked(invoke).mockClear();
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(container.querySelector("[data-machine-summary]")?.textContent).toContain("Disabled");
  expect(localStorage.getItem("bycoda.disabledMachines")).toBe('["env"]');
  // Nothing was removed or revoked: the credential, routes and cache stay.
  const commands = vi.mocked(invoke).mock.calls.map(([command]) => command);
  expect(commands).not.toContain("remote_disconnect");
  expect(commands.some((command) => /revoke|forget|remove|delete/i.test(command))).toBe(false);
  expect(container.textContent).toContain("Home Mac");
  await act(async () =>
    (container.querySelector('[aria-label="Actions for Home Mac"]') as HTMLElement).click(),
  );
  expect(document.querySelector('[role="menuitem"]')).not.toBeNull();
  expect(document.body.textContent).toContain("Remove connection…");
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(localStorage.getItem("bycoda.disabledMachines")).toBe("[]");
  localStorage.removeItem("bycoda.disabledMachines");
});

it("does not restart an SSH Host when interruption approval is cancelled", async () => {
  machines = [machine];
  approveUpdate.mockResolvedValue(false);
  await render();
  await act(async () => button("Update Host").click());
  expect(approveUpdate).toHaveBeenCalledOnce();
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "remote_ssh_reconnect")).toBe(
    false,
  );
});

it("advertises every supported provider when checking a host", async () => {
  machines = [machine];
  await render();
  expect(invoke).toHaveBeenCalledWith("remote_request", {
    machineId: machine.id,
    method: "environment.describe",
    params: { supportedProviders: REMOTE_PROVIDERS },
    expectedEnvironmentId: machine.environmentId,
  });
});

it("does not open the machine edit and remove panels at the same time", async () => {
  machines = [machine];
  await render();
  await pick("Home Mac", "Remove connection…");
  expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  await editMachine("Home Mac");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector('form[aria-label="Edit Home Mac"]')).toBeTruthy();
  expect(container.querySelector('[aria-label="Connection method"]')).toBeNull();
  await pick("Home Mac", "Remove connection…");
  expect(container.querySelector('form[aria-label="Edit Home Mac"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeTruthy();
});

it("names the machine being worked on in connection progress", async () => {
  machines = [machine];
  await render();
  await pick("Home Mac", "Reconnect");
  expect(container.querySelector('[role="status"]')!.textContent).toContain("Home Mac");
  expect(container.textContent).toContain("Host port 3774");
});

it("keeps the open draft when the manual disclosure is clicked while closed views change", async () => {
  machines = [machine];
  await render();
  await openAdvanced();
  await fill(SSH_TARGET, "me@second");
  expect(container.textContent).toContain("Home Mac");
  expect(
    document.querySelector<HTMLInputElement>(
      'input[placeholder="user@my-mac-mini or an SSH alias"]',
    )!.value,
  ).toBe("me@second");
});

it("explains why adding a new machine waits while a setup is in progress", async () => {
  await start();
  expect(container.textContent).toContain(
    "Finish or cancel the current connection before adding another machine.",
  );
  await act(async () => button("Stop").click());
  expect(invoke).toHaveBeenCalledWith("remote_ssh_cancel", { jobId: "setup" });
  state = { ...state, done: true, error: "Connection cancelled" };
  await poll();
  // The dialog closed when setup started; reopening it starts without the old error.
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await openAdvanced();
  expect(document.querySelector('form[aria-label="Add a new computer"]')).toBeTruthy();
  expect(document.body.textContent).not.toContain("Connection cancelled");
});

it("saves the Host port and reconnects without installing the service", async () => {
  machines = [machine];
  await render();
  await editMachine("Home Mac");
  expect(document.querySelector<HTMLInputElement>('input[name="hostPort"]')!.value).toBe("3774");
  await fill('input[name="hostPort"]', "3776");
  await act(async () => button("Save and reconnect").click());
  expect(invoke).toHaveBeenCalledWith("remote_machine_update", {
    machineId: machine.id,
    name: machine.name,
    target: "me@home",
    port: null,
    alternate: null,
    remotePort: 3776,
  });
  expect(invoke).toHaveBeenCalledWith("remote_ssh_reconnect", { machineId: machine.id });
  expect(invoke).not.toHaveBeenCalledWith("remote_ssh_begin", expect.anything());
  state = { ...state, done: true, machine: machines[0] };
  await poll();
  await editMachine("Home Mac");
  expect(document.querySelector<HTMLInputElement>('input[name="hostPort"]')!.value).toBe("3776");
});

it("does not save an invalid Host port", async () => {
  machines = [machine];
  await render();
  await editMachine("Home Mac");
  await fill('input[name="hostPort"]', "0");
  await act(async () =>
    container
      .querySelector('input[name="hostPort"]')!
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(invoke).not.toHaveBeenCalledWith("remote_machine_update", expect.anything());
  expect(container.textContent).toContain("The Host port must be a number from 1 to 65535.");
});
const requested = (method: string) =>
  vi
    .mocked(invoke)
    .mock.calls.some(
      ([command, params]) =>
        command === "remote_request" && (params as { method: string }).method === method,
    );

it("explains removal and removes the saved connection without stopping or revoking", async () => {
  await openRemove();
  expect(invoke).not.toHaveBeenCalledWith("remote_disconnect", {
    machineId: "machine",
  });
  expect(document.body.textContent).toContain("The host and its sessions keep running");
  expect(document.body.textContent).toContain("leaves this desktop's credential valid");
  expect(document.body.textContent).toContain("~/.bycoda-host/bin/bycoda-host service uninstall");
  await act(async () => confirmRemove().click());
  expect(invoke).toHaveBeenCalledWith("remote_disconnect", {
    machineId: "machine",
  });
  expect(requested("devices.revokeSelf")).toBe(false);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([, params]) => JSON.stringify(params ?? {}).includes('"stop"')),
  ).toBe(false);
});

it("revokes this desktop's credential before removing the connection", async () => {
  await openRemove();
  await chooseRevoke();
  await act(async () => confirmRemove().click());
  const calls = vi
    .mocked(invoke)
    .mock.calls.map(([command, params]) =>
      command === "remote_request" ? (params as { method: string }).method : command,
    );
  expect(calls.indexOf("devices.revokeSelf")).toBeGreaterThanOrEqual(0);
  expect(calls.indexOf("remote_disconnect")).toBeGreaterThan(calls.indexOf("devices.revokeSelf"));
  expect(container.textContent).toContain("access was revoked");
});

it("keeps the connection when the host cannot revoke its credential", async () => {
  const fallback = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, params) => {
    if (
      command === "remote_request" &&
      (params as { method: string }).method === "devices.revokeSelf"
    )
      throw "Machine is unreachable";
    return fallback(command, params);
  });
  await openRemove();
  await chooseRevoke();
  await act(async () => confirmRemove().click());
  expect(invoke).not.toHaveBeenCalledWith("remote_disconnect", {
    machineId: "machine",
  });
  expect(document.body.textContent).toContain("Could not revoke access");
  expect(document.body.textContent).toContain("Could not revoke access");
});

it("does not spellcheck or autocorrect the machine name", async () => {
  await render();
  await openAdvanced();
  const name = document.querySelector<HTMLInputElement>(
    'input[placeholder="Optional, e.g. Home Mac mini"]',
  )!;
  expect(name.getAttribute("spellcheck")).toBe("false");
  expect(name.getAttribute("autocorrect")).toBe("off");
  expect(name.getAttribute("autocapitalize")).toBe("off");
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button[aria-label="Connection help"]')!.click(),
  );
  expect(document.body.textContent).toContain("loginctl enable-linger");
});

it("edits a machine's address, saves it first and reconnects through the interactive setup", async () => {
  machines = [machine];
  await render();
  await editMachine("Home Mac");
  const address = 'input[placeholder="user@my-mac-mini or an SSH alias"]';
  expect(document.querySelector<HTMLInputElement>(address)!.value).toBe("me@home");
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button[aria-label="Connection help"]')!.click(),
  );
  expect(document.body.textContent).toContain("A hostname works too");
  await fill(address, "me@10.0.0.9");
  await act(async () => button("Save and reconnect").click());
  expect(invoke).toHaveBeenCalledWith("remote_machine_update", {
    machineId: "machine",
    name: "Home Mac",
    target: "me@10.0.0.9",
    port: null,
    remotePort: 3774,
    alternate: null,
  });
  expect(invoke).toHaveBeenCalledWith("remote_ssh_reconnect", {
    machineId: "machine",
  });
  const order = vi.mocked(invoke).mock.calls.map(([command]) => command);
  expect(order.indexOf("remote_machine_update")).toBeLessThan(
    order.indexOf("remote_ssh_reconnect"),
  );
  state = { ...state, done: true, error: "Host identity changed" };
  await poll();
  expect(container.textContent).toContain("The new address is saved");
});

it("only renames without reconnecting, and offers the host's name for a raw IP", async () => {
  machines = [
    {
      ...machine,
      name: "Mini.local",
      endpoint: "ssh://me@192.168.1.5",
      ssh: { target: "me@192.168.1.5", remotePort: 3774 },
    },
  ];
  await render();
  await editMachine("Mini.local");
  expect(container.textContent).toContain("Use me@Mini.local instead of the IP");
  await act(async () => button("Use me@Mini.local instead of the IP").click());
  const address = 'input[placeholder="user@my-mac-mini or an SSH alias"]';
  expect(document.querySelector<HTMLInputElement>(address)!.value).toBe("me@Mini.local");
  await fill(address, "me@192.168.1.5");
  await fill('input[placeholder="Optional, e.g. Home Mac mini"]', "Office");
  expect(button("Save")).toBeTruthy();
  expect(container.textContent).toContain("Saving changes the computer name without reconnecting.");
  await act(async () => button("Save").click());
  expect(requested("remote_ssh_reconnect")).toBe(false);
  expect(container.textContent).toContain("was renamed");
});

it("switches from editing to a fresh machine without updating the saved machine", async () => {
  machines = [{ ...machine, ssh: { ...machine.ssh!, alternate: "me@tailnet" } }];
  await render();
  await editMachine("Home Mac");
  expect(document.querySelector<HTMLInputElement>('input[placeholder*="Tailscale"]')!.value).toBe(
    "me@tailnet",
  );
  await openAdvanced();
  expect(document.querySelector<HTMLInputElement>('input[placeholder*="Tailscale"]')!.value).toBe(
    "",
  );
  expect(
    document.querySelector<HTMLInputElement>('input[placeholder="Optional, e.g. Home Mac mini"]')!
      .value,
  ).toBe("");
  await fill(SSH_TARGET, "me@office");
  await fill('input[placeholder*="Tailscale"]', "me@office-tailnet");
  await act(async () => button("Connect").click());
  expect(invoke).toHaveBeenCalledWith("remote_ssh_begin", {
    target: "me@office",
    name: "",
    port: null,
    alternate: "me@office-tailnet",
  });
  expect(requested("remote_machine_update")).toBe(false);
  expect(requested("remote_ssh_reconnect")).toBe(false);
});

it("clears edit state after reconnect succeeds so the next connection adds a machine", async () => {
  machines = [machine];
  await render();
  await editMachine("Home Mac");
  await pick("Home Mac", "Reconnect");
  state = { ...state, done: true, machine };
  await poll();
  await openAdvanced();
  expect(document.querySelector('form[aria-label="Add a new computer"]')).toBeTruthy();
  await fill(SSH_TARGET, "me@office");
  await act(async () => button("Connect").click());
  expect(invoke).toHaveBeenCalledWith("remote_ssh_begin", {
    target: "me@office",
    name: "",
    port: null,
    alternate: null,
  });
  expect(requested("remote_machine_update")).toBe(false);
});

it("keeps the other address when saving a new primary address", async () => {
  machines = [{ ...machine, ssh: { ...machine.ssh!, alternate: "me@tailnet" } }];
  await render();
  // Route details sit behind the machine summary's routes disclosure.
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("[data-machine-summary] button[aria-expanded]")!
      .click(),
  );
  expect(container.textContent).toContain("Other address: me@tailnet");
  await editMachine("Home Mac");
  await fill(SSH_TARGET, "me@new-home");
  await act(async () => button("Save and reconnect").click());
  expect(invoke).toHaveBeenCalledWith("remote_machine_update", {
    machineId: "machine",
    name: "Home Mac",
    target: "me@new-home",
    port: null,
    remotePort: 3774,
    alternate: "me@tailnet",
  });
});

it("validates the other address before starting setup", async () => {
  await render();
  await openAdvanced();
  await fill(SSH_TARGET, "me@office");
  await fill('input[placeholder*="Tailscale"]', "-oProxyCommand=bad");
  await act(async () => button("Connect").click());
  expect(requested("remote_ssh_begin")).toBe(false);
  expect(document.querySelector('[role="alert"]')!.textContent).toContain(
    "Enter the other address",
  );
});

it.each([
  ["busy", "RPC_WS_OVERLOAD: Host read capacity is busy; retry later.", false],
  ["unreachable", "Machine is unreachable", true],
])("shows a %s host as offline only when it really is", async (_case, failure, offline) => {
  const fallback = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, params) => {
    if (
      command === "remote_request" &&
      (params as { method: string }).method === "environment.describe"
    )
      throw failure;
    return fallback(command, params);
  });
  machines = [machine];
  await render();
  // A busy host (for example while this computer builds) keeps its last status.
  expect(container.querySelector("[data-machine-summary]")?.textContent?.includes("Offline")).toBe(
    offline,
  );
});
