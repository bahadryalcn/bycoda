// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { saveWorkspaceSnapshot } from "../../features/sessions/data/sessionStore";
import { hasInitializedSessionRecovery } from "../../features/workspace/model/sessionRecovery";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const nativeWindow = vi.hoisted(() => ({ label: "main" }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: nativeWindow.label }),
}));

it("preserves the primary journal when the primary window saves without boot recovery", async () => {
  expect(hasInitializedSessionRecovery()).toBe(false);
  const saved = { capturedAt: 100, dismissed: true, workspace: { marker: "primary recovery" } };
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "workspace_get_snapshot" ? { sessionRecovery: saved } : undefined,
  );
  await saveWorkspaceSnapshot({ tabs: [], activeTabId: "detached" });
  expect(vi.mocked(invoke).mock.calls.at(-1)).toEqual([
    "workspace_set_snapshot",
    { snapshot: { tabs: [], activeTabId: "detached", sessionRecovery: saved } },
  ]);
});

it("does not read or overwrite the primary journal from a detached window", async () => {
  nativeWindow.label = "window-2";
  vi.mocked(invoke).mockClear();
  try {
    await saveWorkspaceSnapshot({ tabs: [], activeTabId: "detached" });
    expect(invoke).not.toHaveBeenCalled();
  } finally {
    nativeWindow.label = "main";
  }
});

it("does not write a replacement snapshot when the primary journal cannot be read", async () => {
  vi.mocked(invoke).mockClear().mockRejectedValue(new Error("database unavailable"));
  await expect(saveWorkspaceSnapshot({ tabs: [], activeTabId: "detached" })).rejects.toThrow(
    "database unavailable",
  );
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
    "workspace_get_snapshot",
  ]);
});
