// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ServerTerminalRestorePreview } from "./ServerTerminalRestorePreview";
import type { ServerRecord } from "../model/serverInventory";
import type { ServerTerminalRestore } from "../model/serverTerminalRestore";

it("previews current canonical target without launching, then connects/removes only on explicit action", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"),
    root = createRoot(container);
  const restore: ServerTerminalRestore = {
    version: 1,
    enabled: true,
    tabs: [
      { tabId: "ui:one", serverId: "saved" },
      { tabId: "ui:missing", serverId: "removed" },
    ],
    activeTabId: "ui:one",
  };
  const server: ServerRecord = {
    id: "saved",
    name: "Current name",
    kind: "ssh",
    sshEndpoint: {
      host: "new-target.invalid",
      user: "alice",
      port: 2222,
      identityFile: "private-reference",
    },
    metadata: { tags: [], favorite: false },
  };
  const onConnect = vi.fn(),
    onRemove = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(ServerTerminalRestorePreview, {
          restore,
          servers: [server],
          onConnect,
          onRemove,
        }),
      ),
    );
    expect(onConnect).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Current name");
    expect(container.textContent).toContain("alice@new-target.invalid:2222");
    expect(container.textContent).not.toContain("private-reference");
    const rows = container.querySelectorAll("li");
    expect(rows[0].getAttribute("aria-current")).toBe("true");
    expect(rows[1].textContent).toContain("Unavailable");
    expect(rows[1].querySelectorAll("button")).toHaveLength(1);
    await act(async () => rows[0].querySelector<HTMLButtonElement>("button")!.click());
    expect(onConnect).toHaveBeenCalledExactlyOnceWith(restore.tabs[0], server);
    await act(async () => rows[1].querySelector<HTMLButtonElement>("button")!.click());
    expect(onRemove).toHaveBeenCalledExactlyOnceWith("ui:missing");
    await act(async () =>
      root.render(
        createElement(ServerTerminalRestorePreview, {
          restore,
          servers: [server],
          inventoryReady: false,
          onConnect,
          onRemove,
        }),
      ),
    );
    expect([...container.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
    expect(onConnect).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
