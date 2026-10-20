// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { requestMachineAdd } from "../model/machineAdd";
import { useSyncStatus } from "../../sync/model/useSyncStatus";
import { REMOTE_PROVIDERS, type RemoteMachine, type SshSetup } from "../model/protocol";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../sync/model/useSyncStatus", () => ({ useSyncStatus: vi.fn() }));
let container: HTMLDivElement;
let root: Root;
let state: SshSetup;
let machines: RemoteMachine[];
const machine: RemoteMachine = {
  id: "machine",
  name: "Home Mac",
  environmentId: "env",
  endpoint: "ssh://me@home",
  ssh: { target: "me@home", remotePort: 3774 },
};
beforeEach(() => {
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
    if (command === "remote_request") return { environmentId: "env", providers: ["codex"] };
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
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const button = (name: string) =>
  [...container.querySelectorAll("button")].find((button) => {
    const copy = button.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
    return copy.textContent?.trim() === name;
  })!;
async function render() {
  await act(async () => root.render(createElement(ConnectionsSettings)));
}

it("keeps sync diagnostics available behind a short error summary", async () => {
  machines = [machine];
  vi.mocked(useSyncStatus).mockReturnValue({
    state: "error",
    lastError: "RPC_HOST_UNAVAILABLE: connection closed; reconnect before retrying",
    pendingOps: 2,
  });
  await render();
  const diagnostics = container.querySelector<HTMLDetailsElement>(".connection-sync-error")!;
  expect(diagnostics.open).toBe(false);
  expect(diagnostics.querySelector("summary")?.textContent).toContain("Sync needs attention");
  expect(diagnostics.querySelector("p")?.textContent).toContain("RPC_HOST_UNAVAILABLE");
  expect(diagnostics.querySelector("p")?.textContent).toContain("2 pending");
  expect(container.querySelector('button[aria-label="Sync now"]')).toBeTruthy();
});

it("opens the existing add editor for a Servers request made before Settings mounts", async () => {
  requestMachineAdd();
  await render();
  expect(
    container.querySelector('input[placeholder="user@my-mac-mini or an SSH alias"]'),
  ).toBeTruthy();
  expect(requested("remote_ssh_begin")).toBe(false);
});

it("keeps a machine draft when moving between connection views", async () => {
  await render();
  await act(async () => button("Add machine").click());
  await fill('input[placeholder="user@my-mac-mini or an SSH alias"]', "me@new-host");
  const choose = (value: string) =>
    container.querySelector<HTMLButtonElement>(`[role="radio"][data-value="${value}"]`)!;
  await act(async () => choose("phone").click());
  expect(container.querySelector(".connections-view:not([hidden])")?.textContent).toContain(
    "Scan a QR code",
  );
  await act(async () => choose("machines").click());
  expect(
    container.querySelector<HTMLInputElement>(
      'input[placeholder="user@my-mac-mini or an SSH alias"]',
    )?.value,
  ).toBe("me@new-host");
  expect(requested("remote_ssh_begin")).toBe(false);
});

it("does not label an untouched URL connection as unsaved", async () => {
  await render();
  const details = container.querySelectorAll("details.connection-disclosure");
  const url = [...details].find((item) =>
    item
      .querySelector(":scope > summary")
      ?.textContent?.includes("Connect to an existing host by URL"),
  )!;
  expect(url.textContent).not.toContain("Unsaved changes");
  expect(url.hasAttribute("open")).toBe(false);
  expect(url.querySelector('input[type="url"]')).toBeTruthy();
});
async function fill(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function start() {
  await render();
  await act(async () => button("Add machine").click());
  await fill('input[placeholder="user@my-mac-mini or an SSH alias"]', "me@home");
  await act(async () => button("Connect").click());
}
async function poll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

it("keeps the existing-host form open and preserves URL and token when connection fails", async () => {
  await render();
  const disclosure = [
    ...container.querySelectorAll<HTMLDetailsElement>("details.connection-disclosure"),
  ].find((item) =>
    item
      .querySelector(":scope > summary")
      ?.textContent?.includes("Connect to an existing host by URL"),
  )!;
  disclosure.open = true;
  await fill('input[type="url"]', "https://remote.example.com");
  await fill('input[type="password"]', "device-token");
  const credential = container.querySelector<HTMLInputElement>('input[type="password"]')!;
  credential.focus();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-controls="' + credential.id + '"]')!
      .click(),
  );
  expect(credential.type).toBe("text");
  expect(credential.value).toBe("device-token");
  expect(document.activeElement).toBe(credential);
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "remote_connect")).toBe(
    false,
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-controls="' + credential.id + '"]')!
      .click(),
  );
  expect(credential.type).toBe("password");
  const previous = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "remote_connect") throw new Error("Host unavailable");
    return previous(command, args);
  });
  await act(async () => button("Connect by URL").click());
  expect(disclosure.isConnected).toBe(true);
  expect(disclosure.open).toBe(true);
  expect(container.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe(
    "https://remote.example.com",
  );
  expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe(
    "device-token",
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Host unavailable");
  expect(button("Retry connection").disabled).toBe(false);
  expect(container.querySelector('[role="status"].text-success')).toBeNull();
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
  expect(
    container.querySelector('input[placeholder="user@my-mac-mini or an SSH alias"]'),
  ).toBeNull();
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
    container.querySelector<HTMLInputElement>('input[aria-label="SSH password or passphrase"]')!
      .value,
  ).toBe("");
});

it("keeps the SSH address after a failed install and cancels active setup when Settings closes", async () => {
  state = { ...state, done: true, error: "Host package is unavailable" };
  await start();
  expect(container.textContent).toContain("Host package is unavailable");
  expect(
    container.querySelector<HTMLInputElement>(
      'input[placeholder="user@my-mac-mini or an SSH alias"]',
    )!.value,
  ).toBe("me@home");
  state = { id: "setup", message: "Connecting…", done: false };
  await act(async () => button("Connect").click());
  await act(async () => root.unmount());
  root = createRoot(container);
  expect(invoke).toHaveBeenCalledWith("remote_ssh_cancel", { jobId: "setup" });
});

async function openRemove() {
  machines = [machine];
  await render();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Remove Home Mac"]')!.click(),
  );
}

it("offers an explicit host update for an SSH machine missing workspace methods", async () => {
  machines = [machine];
  await render();
  expect(container.textContent).toContain("host update needed for Explorer and Changes");
  expect(container.textContent).toContain("interrupts active agent turns");
  await act(async () => button("Update Host").click());
  expect(invoke).toHaveBeenCalledWith("remote_ssh_reconnect", {
    machineId: machine.id,
    upgrade: true,
  });
});

it("advertises every supported provider when checking a host", async () => {
  machines = [machine];
  await render();
  expect(invoke).toHaveBeenCalledWith("remote_request", {
    machineId: machine.id,
    method: "environment.describe",
    params: { supportedProviders: REMOTE_PROVIDERS },
  });
});

it("makine düzenleme ve kaldırma panellerini aynı anda açmaz", async () => {
  machines = [machine];
  await render();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Remove Home Mac"]')!.click(),
  );
  expect(container.querySelector('[aria-label="Confirm removing Home Mac"]')).toBeTruthy();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Edit Home Mac"]')!.click(),
  );
  expect(container.querySelector('[aria-label="Confirm removing Home Mac"]')).toBeNull();
  expect(container.querySelector('form[aria-label="Edit Home Mac"]')).toBeTruthy();
  expect(container.textContent).not.toContain("Connect to an existing host by URL");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Remove Home Mac"]')!.click(),
  );
  expect(container.querySelector('form[aria-label="Edit Home Mac"]')).toBeNull();
  expect(container.querySelector('[aria-label="Confirm removing Home Mac"]')).toBeTruthy();
});

it("bağlantı ilerlemesinde işlem yapılan makineyi belirtir", async () => {
  machines = [machine];
  await render();
  await act(async () => button("Reconnect").click());
  expect(container.querySelector('[role="status"]')!.textContent).toContain("Home Mac");
  expect(container.textContent).toContain("Host port 3774");
});

it("ekleme formu açıkken Makine ekle düğmesini görünür tutar", async () => {
  machines = [machine];
  await render();
  await act(async () => button("Add machine").click());
  await fill('input[placeholder="user@my-mac-mini or an SSH alias"]', "me@second");
  expect(button("Add machine").disabled).toBe(false);
  await act(async () => button("Add machine").click());
  expect(
    container.querySelector<HTMLInputElement>(
      'input[placeholder="user@my-mac-mini or an SSH alias"]',
    )!.value,
  ).toBe("");
  expect(container.textContent).toContain("Home Mac");
});

it("devam eden kurulum sırasında yeni makine eklemenin neden beklediğini açıklar", async () => {
  await start();
  expect(button("Add machine").disabled).toBe(true);
  expect(container.textContent).toContain(
    "Finish or cancel the current connection before adding another machine.",
  );
  await act(async () => button("Cancel connection").click());
  expect(invoke).toHaveBeenCalledWith("remote_ssh_cancel", { jobId: "setup" });
  state = { ...state, done: true, error: "Connection cancelled" };
  await poll();
  expect(button("Add machine").disabled).toBe(false);
  await act(async () => button("Add machine").click());
  expect(container.querySelector('form[aria-label="Add a new machine"]')).toBeTruthy();
  expect(container.textContent).not.toContain("Connection cancelled");
});

it("Host portunu kaydeder ve servis kurulumu yapmadan yeniden bağlanır", async () => {
  machines = [machine];
  await render();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Edit Home Mac"]')!.click(),
  );
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Host port"]')!.value).toBe(
    "3774",
  );
  await fill('input[aria-label="Host port"]', "3776");
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
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Edit Home Mac"]')!.click(),
  );
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Host port"]')!.value).toBe(
    "3776",
  );
});

it("geçersiz Host portunu kaydetmez", async () => {
  machines = [machine];
  await render();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Edit Home Mac"]')!.click(),
  );
  await fill('input[aria-label="Host port"]', "0");
  await act(async () =>
    container
      .querySelector('input[aria-label="Host port"]')!
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
  expect(container.textContent).toContain("It does not stop the host");
  expect(container.textContent).toContain("leaves this desktop’s credential valid");
  expect(container.textContent).toContain("~/.bycoda-host/bin/bycoda-host service uninstall");
  await act(async () => button("Remove from this desktop only").click());
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
  await act(async () => button("Revoke access and remove").click());
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
  await act(async () => button("Revoke access and remove").click());
  expect(invoke).not.toHaveBeenCalledWith("remote_disconnect", {
    machineId: "machine",
  });
  expect(container.textContent).toContain("Could not revoke access");
  expect(button("Remove from this desktop only")).toBeTruthy();
});

it("does not spellcheck or autocorrect the machine name", async () => {
  await render();
  await act(async () => button("Add machine").click());
  const name = container.querySelector<HTMLInputElement>(
    'input[placeholder="Optional, e.g. Home Mac mini"]',
  )!;
  expect(name.getAttribute("spellcheck")).toBe("false");
  expect(name.getAttribute("autocorrect")).toBe("off");
  expect(name.getAttribute("autocapitalize")).toBe("off");
  expect(container.textContent).toContain("loginctl enable-linger");
});

it("edits a machine's address, saves it first and reconnects through the interactive setup", async () => {
  machines = [machine];
  await render();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Edit Home Mac"]')!.click(),
  );
  const address = 'input[placeholder="user@my-mac-mini or an SSH alias"]';
  expect(container.querySelector<HTMLInputElement>(address)!.value).toBe("me@home");
  expect(container.textContent).toContain("A hostname works too");
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
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Edit Mini.local"]')!.click(),
  );
  expect(container.textContent).toContain("Use me@Mini.local instead of the IP");
  await act(async () => button("Use me@Mini.local instead of the IP").click());
  const address = 'input[placeholder="user@my-mac-mini or an SSH alias"]';
  expect(container.querySelector<HTMLInputElement>(address)!.value).toBe("me@Mini.local");
  await fill(address, "me@192.168.1.5");
  await fill('input[placeholder="Optional, e.g. Home Mac mini"]', "Office");
  expect(button("Save")).toBeTruthy();
  await act(async () => button("Save").click());
  expect(requested("remote_ssh_reconnect")).toBe(false);
  expect(container.textContent).toContain("was renamed");
});

it("switches from editing to a fresh machine without updating the saved machine", async () => {
  machines = [{ ...machine, ssh: { ...machine.ssh!, alternate: "me@tailnet" } }];
  await render();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Edit Home Mac"]')!.click(),
  );
  expect(container.querySelector<HTMLInputElement>('input[placeholder*="Tailscale"]')!.value).toBe(
    "me@tailnet",
  );
  await act(async () => button("Add machine").click());
  expect(container.querySelector<HTMLInputElement>('input[placeholder*="Tailscale"]')!.value).toBe(
    "",
  );
  expect(
    container.querySelector<HTMLInputElement>('input[placeholder="Optional, e.g. Home Mac mini"]')!
      .value,
  ).toBe("");
  await fill('input[placeholder="user@my-mac-mini or an SSH alias"]', "me@office");
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
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Edit Home Mac"]')!.click(),
  );
  await act(async () => button("Reconnect").click());
  state = { ...state, done: true, machine };
  await poll();
  await act(async () => button("Add machine").click());
  expect(container.querySelector('form[aria-label="Add a new machine"]')).toBeTruthy();
  await fill('input[placeholder="user@my-mac-mini or an SSH alias"]', "me@office");
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
  expect(container.textContent).toContain("Other address · me@tailnet");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Edit Home Mac"]')!.click(),
  );
  await fill('input[placeholder="user@my-mac-mini or an SSH alias"]', "me@new-home");
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
  await act(async () => button("Add machine").click());
  await fill('input[placeholder="user@my-mac-mini or an SSH alias"]', "me@office");
  await fill('input[placeholder*="Tailscale"]', "-oProxyCommand=bad");
  await act(async () => button("Connect").click());
  expect(requested("remote_ssh_begin")).toBe(false);
  expect(container.querySelector('[role="alert"]')!.textContent).toContain(
    "Enter the other address",
  );
});
