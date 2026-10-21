// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ServersTerminalWorkspace,
  useOpenServerTerminal,
  useGenerateSshKey,
  useOpenQuickServerTerminal,
  useOpenAgentServerTerminal,
} from "./ServersTerminalWorkspace";
import type { ServerRecord } from "../model/serverInventory";
import { serverTerminalRestoreState } from "../model/serverTerminalRestoreState";
vi.mock("../model/serverInventory", () => ({
  useServerInventory: () => ({ servers: [server], loaded: true, loading: false }),
}));
const events = vi.hoisted(() => ({ mounted: [] as string[], unmounted: [] as string[] }));
const configuration = vi.hoisted(() => ({ preview: vi.fn() }));
const proxy = vi.hoisted(() => ({ request: vi.fn() }));
const startup = vi.hoisted(() => ({ request: vi.fn(async () => {}) }));
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("../model/sshRunbookQueue", () => ({
  requestSshStartupReviews: startup.request,
  useSshRunbookQueue: () => ({ intents: [], error: "" }),
}));
vi.mock("./useSshHttpProxyApproval", () => ({
  useSshHttpProxyApproval: () => ({ request: proxy.request, dialog: null }),
}));
vi.mock("../model/sshGroupDefaults", () => ({ previewSshConfiguration: configuration.preview }));
vi.mock("../../terminal/ui/TerminalView", () => ({
  TerminalView: ({
    id,
    sshConnectionId,
    keyGenerationPath,
    active,
    sshEndpoint,
    shellIntegration,
    agentForwardingReviewId,
    expectedConfigurationDigest,
    httpProxyTicketId,
    onEnableShellIntegration,
    onSshPromptReady,
    onStartupReview,
    onReconnect,
  }: {
    id: string;
    sshConnectionId?: string;
    keyGenerationPath?: string;
    active: boolean;
    sshEndpoint?: { host: string; user?: string; port: number };
    shellIntegration?: "auto" | "bash" | "zsh" | "powershell";
    agentForwardingReviewId?: string;
    expectedConfigurationDigest?: string;
    httpProxyTicketId?: string;
    onEnableShellIntegration?: (shell?: "bash" | "zsh" | "powershell") => void;
    onSshPromptReady?: () => void;
    onStartupReview?: () => Promise<void>;
    onReconnect?: () => Promise<void>;
  }) => {
    const target =
      sshConnectionId ??
      (sshEndpoint
        ? `quick:${sshEndpoint.user ?? ""}@${sshEndpoint.host}:${sshEndpoint.port}`
        : `keygen:${keyGenerationPath}`);
    useEffect(() => {
      events.mounted.push(target);
      return () => {
        events.unmounted.push(target);
      };
    }, [id, target]);
    return createElement(
      "div",
      {
        "data-terminal-id": id,
        "data-active": active,
        "data-integration": shellIntegration,
        "data-agent-review": agentForwardingReviewId,
        "data-configuration-digest": expectedConfigurationDigest,
        "data-proxy-ticket": httpProxyTicketId,
      },
      sshConnectionId,
      onReconnect
        ? createElement("button", { onClick: onReconnect }, "Reconnect closed SSH")
        : null,
      createElement("button", { onClick: onSshPromptReady }, "Native ready prompt"),
      createElement("button", { onClick: onStartupReview }, "Review startup scripts"),
      onEnableShellIntegration
        ? createElement(
            "button",
            { onClick: () => onEnableShellIntegration("bash") },
            "Enable session Bash integration",
          )
        : null,
      onEnableShellIntegration
        ? createElement(
            "button",
            { onClick: () => onEnableShellIntegration("zsh") },
            "Enable session Zsh integration",
          )
        : null,
      onEnableShellIntegration
        ? createElement(
            "button",
            { onClick: () => onEnableShellIntegration("powershell") },
            "Enable session PowerShell integration",
          )
        : null,
    );
  },
}));
vi.mock("../../../app/shell/ToolNavigation", () => ({
  ToolHeader: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../../app/shell/WindowControls", () => ({ WindowControls: () => null }));
const server: ServerRecord = {
  id: "canonical-ssh",
  kind: "ssh",
  name: "Target",
  sshEndpoint: { host: "example.invalid", port: 22 },
  metadata: { tags: [], favorite: false },
};
it("cold restore previews the current canonical target and connects a fresh shell-assisted tab only explicitly", async () => {
  serverTerminalRestoreState.initialize({
    version: 1,
    enabled: true,
    tabs: [{ tabId: "old-ui-reference", serverId: server.id, input: "must-not-replay" }],
  });
  await act(async () =>
    root.render(createElement(ServersTerminalWorkspace, { children: createElement(Inventory) })),
  );
  expect(events.mounted).toEqual([]);
  expect(container.textContent).toContain("example.invalid:22");
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Connect")!
      .click(),
  );
  expect(events.mounted).toEqual([server.id]);
  const terminal = container.querySelector("[data-terminal-id]")!;
  expect(terminal.getAttribute("data-terminal-id")).not.toBe("old-ui-reference");
  expect(terminal.getAttribute("data-integration")).toBe("auto");
  expect(serverTerminalRestoreState.getSnapshot().pending).toEqual([]);
  expect(JSON.stringify(serverTerminalRestoreState.getSnapshot().restore)).not.toContain(
    "must-not-replay",
  );
  await act(async () => serverTerminalRestoreState.setEnabled(false));
  expect(events.unmounted).toEqual([]);
});
function Inventory() {
  const open = useOpenServerTerminal();
  return createElement("button", { onClick: () => open?.(server) }, "Open explicit SSH");
}
it("requests startup review once for explicit live terminals and never for restored integration", async () => {
  serverTerminalRestoreState.initialize({ version: 1, enabled: false, tabs: [] });
  const click = async (label: string) =>
    act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === label)!
        .click(),
    );
  const prompt = async () =>
    act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>('[data-integration="bash"] button')]
        .find((button) => button.textContent === "Native ready prompt")!
        .click(),
    );
  await act(async () =>
    root.render(createElement(ServersTerminalWorkspace, { children: createElement(Inventory) })),
  );
  await click("Open explicit SSH");
  expect(startup.request).not.toHaveBeenCalled();
  await click("Enable session Bash integration");
  await prompt();
  await prompt();
  expect(startup.request).toHaveBeenCalledExactlyOnceWith(server.id);
  await act(async () => root.render(null));
  startup.request.mockClear();
  serverTerminalRestoreState.initialize({
    version: 1,
    enabled: true,
    tabs: [{ tabId: "saved-tab", serverId: server.id }],
  });
  await act(async () =>
    root.render(createElement(ServersTerminalWorkspace, { children: createElement(Inventory) })),
  );
  await click("Connect");
  await click("Review startup scripts");
  expect(startup.request).toHaveBeenCalledExactlyOnceWith(server.id);
  startup.request.mockClear();
  await click("Enable session Bash integration");
  await prompt();
  expect(startup.request).not.toHaveBeenCalled();
});
it("reviews inherited configuration before a new terminal and never persists the configuration digest", async () => {
  const grouped: ServerRecord = {
    ...server,
    metadata: {
      ...server.metadata,
      sshInheritance: { groupId: "defaults-1", fields: ["user"], environment: true },
    },
  };
  const digest = "a".repeat(64);
  let finish!: (value: unknown) => void;
  configuration.preview.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  function GroupAction() {
    const open = useOpenServerTerminal();
    return createElement("button", { onClick: () => open?.(grouped) }, "Open grouped SSH");
  }
  serverTerminalRestoreState.initialize({ version: 1, enabled: true, tabs: [] });
  await act(async () =>
    root.render(createElement(ServersTerminalWorkspace, { children: createElement(GroupAction) })),
  );
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Open grouped SSH")!
      .click(),
  );
  expect(events.mounted).toEqual([]);
  expect(configuration.preview).toHaveBeenCalledWith(server.id, null, true);
  await act(async () =>
    finish({
      connectionId: server.id,
      inheritance: grouped.metadata.sshInheritance,
      configuration: {
        endpoint: { host: "effective.example", user: "inherited-user", port: 2222 },
        provenance: { user: { source: "group", groupId: "defaults-1", revision: 3 } },
        environment: [{ name: "APP_MESSAGE", value: "literal $(not executed)" }],
        shellKind: "posix",
        digest,
      },
    }),
  );
  expect(events.mounted).toEqual([]);
  expect(document.body.textContent).toContain("inherited-user@effective.example:2222");
  expect(document.body.textContent).toContain("literal $(not executed)");
  await act(async () =>
    [...document.querySelectorAll('[role="dialog"] button')]
      .find((button) => button.textContent === "Connect")!
      .click(),
  );
  expect(events.mounted).toEqual([server.id]);
  expect(
    container
      .querySelector("[data-configuration-digest]")
      ?.getAttribute("data-configuration-digest"),
  ).toBe(digest);
  expect(JSON.stringify(serverTerminalRestoreState.getSnapshot())).not.toContain(digest);
});
it("keeps a reviewed agent launch ephemeral and never carries approval into a new integrated tab", async () => {
  function ApprovedAction() {
    const open = useOpenAgentServerTerminal();
    return createElement(
      "button",
      { onClick: () => open?.(server, "one-use-review") },
      "Approved agent session",
    );
  }
  serverTerminalRestoreState.initialize({ version: 1, enabled: true, tabs: [] });
  await act(async () =>
    root.render(
      createElement(ServersTerminalWorkspace, { children: createElement(ApprovedAction) }),
    ),
  );
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Approved agent session")!
      .click(),
  );
  expect(container.querySelector('[data-agent-review="one-use-review"]')).not.toBeNull();
  expect(serverTerminalRestoreState.getSnapshot().restore.tabs).toEqual([]);
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Enable session Bash integration")!
      .click(),
  );
  expect(
    container.querySelector('[data-integration="bash"]')?.getAttribute("data-agent-review"),
  ).toBeNull();
  expect(container.querySelectorAll('[data-agent-review="one-use-review"]')).toHaveLength(1);
  expect(JSON.stringify(serverTerminalRestoreState.getSnapshot())).not.toContain("one-use-review");
});
it("opens an unsaved endpoint only explicitly and retains the raw terminal when opting into Bash", async () => {
  function QuickActions() {
    const quick = useOpenQuickServerTerminal();
    return createElement(
      "button",
      { onClick: () => quick?.({ host: "quick.example", user: "bob", port: 2222 }) },
      "Quick explicit SSH",
    );
  }
  await act(async () =>
    root.render(createElement(ServersTerminalWorkspace, { children: createElement(QuickActions) })),
  );
  expect(events.mounted).toEqual([]);
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Quick explicit SSH")!
      .click(),
  );
  expect(events.mounted).toEqual(["quick:bob@quick.example:2222"]);
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Enable session Bash integration")!
      .click(),
  );
  expect(events.mounted).toEqual(["quick:bob@quick.example:2222", "quick:bob@quick.example:2222"]);
  expect(events.unmounted).toEqual([]);
  expect(container.querySelectorAll('[data-integration="bash"]')).toHaveLength(1);
  await act(async () => root.render(null));
  await act(async () =>
    root.render(createElement(ServersTerminalWorkspace, { children: createElement(QuickActions) })),
  );
  expect(container.querySelectorAll("[data-terminal-id]")).toHaveLength(0);
});
let container: HTMLDivElement;
it.each([
  ["zsh", "Zsh"],
  ["powershell", "PowerShell"],
])(
  "opens explicit %s in a separate tab and retains the existing raw connection",
  async (mode, label) => {
    await act(async () =>
      root.render(createElement(ServersTerminalWorkspace, { children: createElement(Inventory) })),
    );
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Open explicit SSH")!
        .click(),
    );
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === `Enable session ${label} integration`)!
        .click(),
    );
    expect(container.querySelectorAll(`[data-integration="${mode}"]`)).toHaveLength(1);
    expect(events.mounted).toEqual(["canonical-ssh", "canonical-ssh"]);
    expect(events.unmounted).toEqual([]);
  },
);
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  events.mounted = [];
  events.unmounted = [];
  startup.request.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

it("does not create or restore a proxy terminal before approval and keeps its ticket ephemeral", async () => {
  const target: ServerRecord = {
    ...server,
    sshEndpoint: {
      host: "proxy-target.test",
      port: 22,
      httpProxy: { host: "upstream.test", port: 3128 },
    },
  };
  const before = JSON.stringify(serverTerminalRestoreState.getSnapshot());
  proxy.request.mockResolvedValueOnce(null).mockResolvedValueOnce("one-use-proxy-ticket");
  function ProxyAction() {
    const open = useOpenServerTerminal();
    return createElement("button", { onClick: () => open?.(target) }, "Open proxy");
  }
  await act(async () =>
    root.render(createElement(ServersTerminalWorkspace, { children: createElement(ProxyAction) })),
  );
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(events.mounted).toEqual([]);
  expect(JSON.stringify(serverTerminalRestoreState.getSnapshot())).toBe(before);
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(events.mounted).toEqual([server.id]);
  const terminal = container.querySelector("[data-terminal-id]")!;
  expect(terminal.getAttribute("data-proxy-ticket")).toBe("one-use-proxy-ticket");
  expect(proxy.request).toHaveBeenLastCalledWith({
    connectionId: server.id,
    endpoint: target.sshEndpoint,
    operation: {
      kind: "terminal",
      id: terminal.getAttribute("data-terminal-id"),
      shellIntegration: "auto",
    },
  });
  expect(JSON.stringify(serverTerminalRestoreState.getSnapshot())).not.toContain(
    "one-use-proxy-ticket",
  );
});

it("reconnects with a fresh canonical target, proxy approval and a fresh PTY without startup replay", async () => {
  await act(async () =>
    root.render(createElement(ServersTerminalWorkspace, { children: createElement(Inventory) })),
  );
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Open explicit SSH")!
      .click(),
  );
  const oldId = container.querySelector("[data-terminal-id]")!.getAttribute("data-terminal-id");
  const current = {
    ...server,
    sshEndpoint: { host: "changed.test", port: 22, httpProxy: { host: "proxy.test", port: 3128 } },
  };
  native.invoke.mockResolvedValueOnce([current]);
  proxy.request.mockResolvedValueOnce("fresh-reconnect-ticket");
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Reconnect closed SSH")!
      .click(),
  );
  expect(native.invoke).toHaveBeenCalledWith("server_inventory_list");
  expect(proxy.request).toHaveBeenLastCalledWith(
    expect.objectContaining({ endpoint: current.sshEndpoint }),
  );
  const fresh = container.querySelector('[data-active="true"][data-terminal-id]')!;
  expect(fresh.getAttribute("data-terminal-id")).not.toBe(oldId);
  expect(fresh.getAttribute("data-proxy-ticket")).toBe("fresh-reconnect-ticket");
  expect(fresh.getAttribute("data-integration")).toBe("auto");
  await act(async () =>
    [...fresh.querySelectorAll("button")]
      .find((button) => button.textContent === "Native ready prompt")!
      .click(),
  );
  expect(startup.request).not.toHaveBeenCalled();
});

it("generates a key only after the explicit action and does not restore keygen on remount", async () => {
  function KeyActions() {
    const generate = useGenerateSshKey();
    return createElement(
      "button",
      { onClick: () => generate?.("C:/disposable/id_ed25519") },
      "Generate explicit key",
    );
  }
  const render = () =>
    root.render(createElement(ServersTerminalWorkspace, { children: createElement(KeyActions) }));
  await act(async () => render());
  expect(events.mounted).toEqual([]);
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Generate explicit key")!
      .click(),
  );
  expect(events.mounted).toEqual(["keygen:C:/disposable/id_ed25519"]);
  expect(container.textContent).toContain("C:/disposable/id_ed25519");
  await act(async () => root.render(null));
  await act(async () => render());
  expect(events.mounted).toHaveLength(1);
  expect(container.querySelectorAll("[data-terminal-id]")).toHaveLength(0);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("moves tab selection and focus with arrows and Home without restarting terminals", async () => {
  await act(async () =>
    root.render(createElement(ServersTerminalWorkspace, { children: createElement(Inventory) })),
  );
  const open = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Open explicit SSH",
  )!;
  await act(async () => open.click());
  await act(async () => open.click());
  const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0]);
  await act(async () =>
    tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })),
  );
  expect(document.activeElement).toBe(tabs[0]);
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  await act(async () =>
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
  );
  expect(document.activeElement).toBe(tabs[1]);
  expect(
    document
      .getElementById(tabs[1].getAttribute("aria-controls")!)
      ?.getAttribute("aria-labelledby"),
  ).toBe(tabs[1].id);
  expect(events.mounted).toHaveLength(2);
  expect(events.unmounted).toEqual([]);
});
it("only explicit terminal opening mounts a process view, preserves it on inventory return, and closes once", async () => {
  await act(async () =>
    root.render(createElement(ServersTerminalWorkspace, { children: createElement(Inventory) })),
  );
  expect(events.mounted).toEqual([]);
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Open explicit SSH")!
      .click(),
  );
  expect(events.mounted).toEqual(["canonical-ssh"]);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Servers"]')!.click(),
  );
  expect(events.unmounted).toEqual([]);
  expect(container.querySelectorAll("[data-terminal-id]")).toHaveLength(1);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Close terminal: Target"]')!.click(),
  );
  expect(events.unmounted).toEqual(["canonical-ssh"]);
});
it("never restores prior process views after a workspace unmount/remount", async () => {
  const render = () =>
    root.render(createElement(ServersTerminalWorkspace, { children: createElement(Inventory) }));
  await act(async () => render());
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Open explicit SSH")!
      .click(),
  );
  await act(async () => root.render(null));
  await act(async () => render());
  expect(events.mounted).toEqual(["canonical-ssh"]);
  expect(container.querySelectorAll("[data-terminal-id]")).toHaveLength(0);
});
it("suspends terminal focus while another tool is visible and retains its process", async () => {
  const render = (visible: boolean) =>
    root.render(
      createElement(ServersTerminalWorkspace, { visible, children: createElement(Inventory) }),
    );
  await act(async () => render(true));
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Open explicit SSH")!
      .click(),
  );
  expect(container.querySelector("[data-terminal-id]")?.getAttribute("data-active")).toBe("true");
  await act(async () => render(false));
  expect(container.querySelector("[data-terminal-id]")?.getAttribute("data-active")).toBe("false");
  await act(async () => render(true));
  expect(container.querySelector("[data-terminal-id]")?.getAttribute("data-active")).toBe("true");
  expect(events.mounted).toHaveLength(1);
  expect(events.unmounted).toEqual([]);
});
