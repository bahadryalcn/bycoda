// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfigImportChoices, ServersConnectionTools } from "./ServersConnectionTools";
import type { ServerRecord } from "../model/serverInventory";
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("./SshRunbooks", () => ({
  SshRunbooks: ({
    runId,
    onRun,
    onClose,
  }: {
    runId?: string;
    onRun: (id: string) => void;
    onClose: () => void;
  }) =>
    createElement(
      "div",
      {},
      `Synthetic runbook:${runId ?? "none"}`,
      createElement(
        "button",
        { onClick: () => onRun("canonical-run-id") },
        "Synthetic run dispatch",
      ),
      createElement("button", { onClick: onClose }, "Synthetic close runbooks"),
    ),
}));
const terminalHooks = vi.hoisted(() => ({
  openAgent: undefined as undefined | ReturnType<typeof vi.fn>,
  open: undefined as undefined | ReturnType<typeof vi.fn>,
}));
vi.mock("./SshAgentForwarding", () => ({
  SshAgentForwarding: ({
    server,
    onApprove,
  }: {
    server: ServerRecord;
    onApprove: (server: ServerRecord, id: string) => void;
  }) =>
    createElement(
      "button",
      { onClick: () => onApprove(server, "review-fixture") },
      "Synthetic reviewed approval",
    ),
}));
vi.mock("./SshGroupSettings", () => ({
  SshGroupSettings: ({ server }: { server: ServerRecord }) =>
    createElement("span", {}, `Synthetic SSH group settings:${server.id}`),
}));
vi.mock("./ServerActivity", () => ({ ServerActivity: () => null }));
vi.mock("./ServersTerminalWorkspace", () => ({
  useOpenServerTerminal: () => terminalHooks.open,
  useOpenAgentServerTerminal: () => terminalHooks.openAgent,
  useGenerateSshKey: () => undefined,
}));
vi.mock("./ServerFiles", () => ({ ServerFiles: () => null }));
vi.mock("./ServerSnippets", () => ({ ServerSnippets: () => null }));
vi.mock("./ServerForwards", () => ({ ServerForwards: () => null }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  bridge.invoke.mockImplementation(async (command: string) =>
    command === "ssh_agent_identities" ? { status: "empty", identities: [] } : [],
  );
  terminalHooks.openAgent = undefined;
  terminalHooks.open = undefined;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
const existing: ServerRecord = {
  id: "keep-id",
  name: "Saved identity",
  kind: "ssh",
  sshEndpoint: { host: "server.invalid", user: "alice", port: 22 },
  metadata: { tags: [], favorite: false },
};
const host = { alias: "imported-alias", endpoint: existing.sshEndpoint!, duplicate: false };
it("keeps connection explicit and retains organization drafts when changing tool panels", async () => {
  terminalHooks.open = vi.fn();
  await act(async () => root.render(createElement(ServersConnectionTools, { server: existing })));
  const find = (label: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === label)!;
  expect(find("Connect via SSH").closest("[hidden]")).toBeNull();
  expect(find("SSH runbooks").closest("[hidden]")).toBeTruthy();
  await act(async () => find("Settings").click());
  const label = [...container.querySelectorAll("label")].find(
    (item) => item.textContent === "Group",
  )!;
  const group = container.querySelector<HTMLInputElement>(`#${label.htmlFor}`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      group,
      "Unfinished group",
    );
    group.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => find("Automation").click());
  expect(find("SSH runbooks").closest("[hidden]")).toBeNull();
  await act(async () => find("Settings").click());
  expect(group.value).toBe("Unfinished group");
  expect(bridge.invoke).not.toHaveBeenCalled();
  expect(terminalHooks.open).not.toHaveBeenCalled();
  await act(async () => find("Connect via SSH").click());
  expect(terminalHooks.open).toHaveBeenCalledExactlyOnceWith(existing);
});
it("persists the key assignment once and reuses the saved server on later connects and remount", async () => {
  const saved: ServerRecord = {
    ...existing,
    sshEndpoint: { ...existing.sshEndpoint!, identityFile: "C:/keys/work" },
  };
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === "ssh_public_keys_list")
      return [
        { identityFile: "C:/keys/work", keyType: "ssh-ed25519", fingerprint: "SHA256:public" },
      ];
    if (command === "ssh_agent_identities") return { status: "unavailable", identities: [] };
    if (command === "server_ssh_identity_set") return saved;
    return [];
  });
  terminalHooks.open = vi.fn();
  await act(async () => root.render(createElement(ServersConnectionTools, { server: existing })));
  const find = (label: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === label)!;
  await act(async () => find("Settings").click());
  await act(async () => find("SSH settings").click());
  const choose = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Assign key: C:/keys/work (Saved identity)"]',
  )!;
  expect(choose).toBeTruthy();
  await act(async () => choose.click());
  expect(bridge.invoke).toHaveBeenCalledWith("server_ssh_identity_set", {
    id: existing.id,
    identityFile: "C:/keys/work",
  });
  expect(choose.disabled).toBe(true);
  expect(choose.textContent).toContain("Assigned");
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Edit SSH server");
  expect(terminalHooks.open).not.toHaveBeenCalled();
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')!
      .click(),
  );
  await act(async () => find("Connect via SSH").click());
  await act(async () => find("Connect via SSH").click());
  expect(terminalHooks.open).toHaveBeenNthCalledWith(1, saved);
  expect(terminalHooks.open).toHaveBeenNthCalledWith(2, saved);
  await act(async () => root.render(null));
  await act(async () => root.render(createElement(ServersConnectionTools, { server: saved })));
  await act(async () => find("Settings").click());
  await act(async () => find("SSH settings").click());
  expect(
    document.querySelector<HTMLButtonElement>('button[aria-label^="Assign key:"]')?.disabled,
  ).toBe(true);
  expect(
    bridge.invoke.mock.calls.filter(([command]) => command === "server_ssh_identity_set"),
  ).toHaveLength(1);
});
it.each(["host", "inherited"])("assigns a persistent key to a %s connection", async (kind) => {
  const base: ServerRecord =
    kind === "host"
      ? {
          ...existing,
          kind: "host",
          sshEndpoint: undefined,
          machine: {
            id: existing.id,
            name: existing.name,
            endpoint: "ssh://alice@server.invalid",
            environmentId: "env",
            ssh: { target: "alice@server.invalid", port: 22, remotePort: 3776 },
          },
        }
      : {
          ...existing,
          metadata: {
            ...existing.metadata,
            sshInheritance: { groupId: "group", fields: ["identityFile"] },
          },
          effectiveSshEndpoint: { ...existing.sshEndpoint!, identityFile: "C:/keys/work" },
        };
  const saved: ServerRecord =
    kind === "host"
      ? {
          ...base,
          machine: {
            ...base.machine!,
            ssh: { ...base.machine!.ssh!, identityFile: "C:/keys/work" },
          },
        }
      : {
          ...base,
          sshEndpoint: { ...base.sshEndpoint!, identityFile: "C:/keys/work" },
          metadata: { ...base.metadata, sshInheritance: { groupId: "group", fields: [] } },
        };
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === "ssh_public_keys_list")
      return [
        { identityFile: "C:/keys/work", keyType: "ssh-ed25519", fingerprint: "SHA256:public" },
      ];
    if (command === "ssh_agent_identities") return { status: "unavailable", identities: [] };
    if (command === "server_ssh_identity_set") return saved;
    return [];
  });
  await act(async () => root.render(createElement(ServersConnectionTools, { server: base })));
  const find = (label: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === label)!;
  await act(async () => find("Settings").click());
  await act(async () => find("SSH settings").click());
  const choose = document.querySelector<HTMLButtonElement>('button[aria-label^="Assign key:"]')!;
  expect(choose.disabled).toBe(false);
  await act(async () => choose.click());
  expect(choose.disabled).toBe(true);
  expect(choose.getAttribute("aria-pressed")).toBe("true");
  expect(bridge.invoke).toHaveBeenCalledWith("server_ssh_identity_set", {
    id: base.id,
    identityFile: "C:/keys/work",
  });
});
it("does not replace a saved key when assigning another key fails", async () => {
  const saved = {
    ...existing,
    sshEndpoint: { ...existing.sshEndpoint!, identityFile: "C:/keys/previous" },
  };
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === "ssh_public_keys_list")
      return [
        { identityFile: "C:/keys/work", keyType: "ssh-ed25519", fingerprint: "SHA256:public" },
      ];
    if (command === "ssh_agent_identities") return { status: "unavailable", identities: [] };
    if (command === "server_ssh_identity_set") throw new Error("Could not save key");
    return [];
  });
  await act(async () => root.render(createElement(ServersConnectionTools, { server: saved })));
  const find = (label: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === label)!;
  await act(async () => find("Settings").click());
  await act(async () => find("SSH settings").click());
  const choose = document.querySelector<HTMLButtonElement>('button[aria-label^="Assign key:"]')!;
  await act(async () => choose.click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Could not save key");
  expect(choose.disabled).toBe(false);
  expect(choose.getAttribute("aria-pressed")).toBe("false");
  expect(container.textContent).toContain("C:/keys/previous");
});
it("offers target-explicit use/edit/skip for a duplicate and cannot import over it", async () => {
  const onUse = vi.fn(),
    onEdit = vi.fn(),
    onSkip = vi.fn(),
    onImport = vi.fn();
  await act(async () =>
    root.render(
      createElement(ConfigImportChoices, {
        host,
        existing: [existing],
        busy: false,
        onUse,
        onEdit,
        onSkip,
        onImport,
      }),
    ),
  );
  const find = (label: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === label);
  expect(find("Import")).toBeUndefined();
  expect(container.textContent).toContain("Saved identity");
  await act(async () => find("Use existing")!.click());
  expect(onUse).toHaveBeenCalledWith(existing);
  await act(async () => find("Edit existing")!.click());
  expect(onEdit).toHaveBeenCalledWith(existing);
  await act(async () => find("Skip")!.click());
  expect(onSkip).toHaveBeenCalledOnce();
  expect(onImport).not.toHaveBeenCalled();
});
it("allows explicit import only for a new endpoint; repeated aliases can be skipped", async () => {
  const onImport = vi.fn(),
    onSkip = vi.fn();
  await act(async () =>
    root.render(
      createElement(ConfigImportChoices, { host, existing: [], busy: false, onImport, onSkip }),
    ),
  );
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Import")!
      .click(),
  );
  expect(onImport).toHaveBeenCalledOnce();
  await act(async () =>
    root.render(
      createElement(ConfigImportChoices, {
        host: { ...host, duplicate: true },
        existing: [],
        busy: false,
        onImport,
        onSkip,
      }),
    ),
  );
  expect(
    [...container.querySelectorAll("button")].some((button) => button.textContent === "Import"),
  ).toBe(false);
  expect(container.textContent).toContain("Duplicate entry");
});

it("previews certificate and ordered jump references before an import choice", async () => {
  const endpoint = {
    ...host.endpoint,
    certificateFile: "C:/keys/user-certificate",
    jumpHosts: ["alice@first:22", "bob@second:2222"],
  };
  await act(async () =>
    root.render(
      createElement(ConfigImportChoices, {
        host: { ...host, endpoint },
        existing: [],
        busy: false,
        onImport: vi.fn(),
        onSkip: vi.fn(),
      }),
    ),
  );
  expect(container.textContent).toContain("Public SSH certificate file: C:/keys/user-certificate");
  expect(container.textContent).toContain("alice@first:22 → bob@second:2222");
  const help = container.querySelector("details")!;
  expect(help.open).toBe(false);
  expect(help.querySelector("summary")?.textContent).toBe("Jump host authentication");
  expect(help.textContent).toContain(
    "Each jump host uses its own identity and host-key verification",
  );
  expect(help.textContent).toContain("choose a different key for each hop");
});

it("offers agent forwarding only with the compatible terminal owner and delegates explicit approval", async () => {
  await act(async () => root.render(createElement(ServersConnectionTools, { server: existing })));
  expect(
    [...container.querySelectorAll("button")].find((b) => b.textContent === "Forward SSH agent"),
  ).toBeUndefined();
  const open = vi.fn();
  terminalHooks.openAgent = open;
  await act(async () => root.render(createElement(ServersConnectionTools, { server: existing })));
  const action = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Forward SSH agent",
  )!;
  expect(open).not.toHaveBeenCalled();
  await act(async () => action.click());
  expect(open).not.toHaveBeenCalled();
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent === "Synthetic reviewed approval")!
      .click(),
  );
  expect(open).toHaveBeenCalledExactlyOnceWith(existing, "review-fixture");
  await act(async () =>
    root.render(
      createElement(ServersConnectionTools, {
        server: { ...existing, kind: "host", sshEndpoint: undefined },
      }),
    ),
  );
  expect(
    [...container.querySelectorAll("button")].find((b) => b.textContent === "Forward SSH agent"),
  ).toBeUndefined();
});

it("keeps the HTTP route visible in selected-server tools without opening settings", async () => {
  await act(async () =>
    root.render(
      createElement(ServersConnectionTools, {
        server: {
          ...existing,
          sshEndpoint: { ...existing.sshEndpoint!, httpProxy: { host: "2001:db8::1", port: 3128 } },
        },
      }),
    ),
  );
  expect(container.textContent).toContain("HTTP CONNECT: [2001:db8::1]:3128");
});

it("opens group defaults explicitly for personal SSH records without treating a legacy label as inheritance", async () => {
  await act(async () =>
    root.render(
      createElement(ServersConnectionTools, {
        server: { ...existing, metadata: { ...existing.metadata, group: "legacy-label" } },
      }),
    ),
  );
  expect(container.textContent).not.toContain("Synthetic SSH group settings");
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "SSH group settings")!
      .click(),
  );
  expect(container.textContent).toContain(`Synthetic SSH group settings:${existing.id}`);
  await act(async () =>
    root.render(
      createElement(ServersConnectionTools, {
        server: { ...existing, kind: "host", sshEndpoint: undefined },
      }),
    ),
  );
  expect(
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "SSH group settings",
    ),
  ).toBeUndefined();
});

it("retains only the explicit run identity when runbooks reopen and excludes host records", async () => {
  await act(async () => root.render(createElement(ServersConnectionTools, { server: existing })));
  const find = (text: string) =>
    [...container.querySelectorAll("button")].find((item) => item.textContent === text)!;
  await act(async () => find("SSH runbooks").click());
  expect(container.textContent).toContain("Synthetic runbook:none");
  await act(async () => find("Synthetic run dispatch").click());
  await act(async () => find("Synthetic close runbooks").click());
  await act(async () => find("SSH runbooks").click());
  expect(container.textContent).toContain("Synthetic runbook:canonical-run-id");
  await act(async () =>
    root.render(
      createElement(ServersConnectionTools, {
        server: { ...existing, kind: "host", sshEndpoint: undefined },
      }),
    ),
  );
  expect(find("SSH runbooks")).toBeUndefined();
});
it("deduplicates an import against the effective inherited endpoint while editing the preserved base record", async () => {
  const inherited = {
    ...existing,
    effectiveSshEndpoint: { ...existing.sshEndpoint!, user: "inherited-user", port: 2222 },
  };
  bridge.invoke.mockImplementation(async (command: string) =>
    command === "ssh_agent_identities"
      ? { status: "empty", identities: [] }
      : command === "ssh_config_preview"
        ? {
            hosts: [
              {
                alias: "effective-import",
                endpoint: inherited.effectiveSshEndpoint,
                duplicate: false,
              },
            ],
            warnings: [],
          }
        : [],
  );
  const edit = vi.fn();
  await act(async () =>
    root.render(
      createElement(ServersConnectionTools, {
        server: inherited,
        servers: [inherited],
        onEditServer: edit,
      }),
    ),
  );
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((item) => item.textContent === "SSH settings")!
      .click(),
  );
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((item) => item.textContent === "Preview")!
      .click(),
  );
  expect(document.body.textContent).toContain("Saved identity");
  const editExisting = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === "Edit existing",
  )!;
  expect(editExisting).toBeTruthy();
  expect(
    [...document.querySelectorAll("button")].some((item) => item.textContent === "Import"),
  ).toBe(false);
  await act(async () => editExisting.click());
  expect(edit).toHaveBeenCalledWith(inherited);
  expect(edit.mock.calls[0][0].sshEndpoint.user).toBe("alice");
});
