// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { recordSyncStatus } from "../../sync/model/syncClient";
import { ConnectionSyncLine } from "./ConnectionSyncLine";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

async function render(machineId: string, onSyncNow?: () => void) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(ConnectionSyncLine, { machineId, onSyncNow })));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  };
  return container;
}

it("shows a paused warning with a Sync now control for an unreachable machine", async () => {
  recordSyncStatus("m-paused", {
    state: "error",
    lastError: "Machine is unreachable. Check the host and SSH tunnel, then reconnect.",
  });
  const onSyncNow = vi.fn();
  const container = await render("m-paused", onSyncNow);
  expect(container.textContent).toContain(
    "Sync is paused because this machine did not answer. It retries automatically.",
  );
  expect(container.textContent).not.toContain("needs attention");
  expect(container.querySelector("[data-sync-tone]")?.getAttribute("data-sync-tone")).toBe(
    "warning",
  );
  const button = Array.from(container.querySelectorAll("button")).find(
    (entry) => entry.textContent === "Sync now",
  );
  await act(async () => button?.click());
  expect(onSyncNow).toHaveBeenCalledTimes(1);
});

it("shows other errors as a danger failure", async () => {
  recordSyncStatus("m-failed", { state: "error", lastError: "Disk full" });
  const container = await render("m-failed");
  expect(container.textContent).toContain("Sync failed: Disk full");
  expect(container.querySelector("[data-sync-tone]")?.getAttribute("data-sync-tone")).toBe(
    "danger",
  );
  expect(container.querySelector("button")).toBeNull();
});

it("shows plain muted text when synced, with the pending suffix", async () => {
  recordSyncStatus("m-ok", { state: "ok", lastSyncAt: Date.now(), pendingOps: 2 });
  const container = await render("m-ok");
  expect(container.textContent).toContain("Synced");
  expect(container.textContent).toContain("2 pending changes");
  expect(container.querySelector("[data-sync-tone]")?.getAttribute("data-sync-tone")).toBe("muted");
  expect(container.querySelector("button")).toBeNull();
});
