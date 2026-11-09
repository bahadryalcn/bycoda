// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  account: { state: { phase: "signed-out", notice: null, message: null } as unknown },
  snapshot: { phase: "idle", currentVersion: "1.0.0" } as unknown,
  openUrl: vi.fn(),
  identity: { displayName: "bycoda", repositoryUrl: "https://github.com/example/bycoda" },
}));
vi.mock("../../features/account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../features/account")>()),
  useAccount: () => ({
    state: mocks.account.state,
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
  }),
}));
vi.mock("../../features/assistant/hooks/useAssistantPresence", () => ({
  useAssistantPresence: () => ({
    hidden: false,
    state: "away",
    label: "Away",
    items: [],
    begin: vi.fn(),
    end: vi.fn(),
    pick: () => false,
  }),
}));
vi.mock("../model/useAppUpdater", () => ({
  useAppUpdater: () => ({ snapshot: mocks.snapshot, notes: "", setSnapshot: vi.fn() }),
  claimStartupUpdatePrompt: () => false,
  installAppUpdate: vi.fn(),
}));
vi.mock("../../shared/lib/productIdentity", () => ({ PRODUCT_IDENTITY: mocks.identity }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
import { SidebarAccountFooter } from "./SidebarAccountFooter";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  mocks.openUrl.mockResolvedValue(undefined);
  mocks.account.state = { phase: "signed-out", notice: null, message: null };
  mocks.snapshot = { phase: "idle", currentVersion: "1.0.0" };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = (props = {}) =>
  act(async () => root.render(createElement(SidebarAccountFooter, props)));
const byLabel = (label: string) => container.querySelector<HTMLElement>(`[aria-label="${label}"]`);

it("shows the guest account with the Settings button only, no feedback, star or update", async () => {
  const onOpenSettings = vi.fn();
  await render({ onOpenSettings });
  expect(byLabel("Account: Guest. Away")).not.toBeNull();
  await act(async () => byLabel("Settings")!.click());
  expect(onOpenSettings).toHaveBeenCalledOnce();
  expect(byLabel("Send feedback")).toBeNull();
  expect(byLabel("View bycoda on GitHub")).toBeNull();
  expect(byLabel("Dismiss GitHub repository prompt")).toBeNull();
  expect(container.querySelector('[aria-label^="Update"]')).toBeNull();
  expect(container.querySelectorAll("button")).toHaveLength(2);
});

it("marks a waiting update with a dot", async () => {
  mocks.snapshot = { phase: "available", currentVersion: "1.0.0", availableVersion: "1.1.0" };
  await render();
  const update = byLabel("Update to 1.1.0");
  expect(update).not.toBeNull();
  expect(update!.querySelector("[data-tone]")).not.toBeNull();
});

it("uses the signed-in name", async () => {
  mocks.account.state = {
    phase: "signed-in",
    context: { user: { displayName: "Ada", email: "ada@example.com", avatarUrl: null } },
    deviceId: null,
    verifiedAt: 0,
    stale: false,
  };
  await render();
  expect(byLabel("Account: Ada. Away")).not.toBeNull();
});

it("stacks the compact variant with account and Settings only", async () => {
  await render({ compact: true });
  expect(container.querySelector('[data-sidebar-account-footer="compact"]')).not.toBeNull();
  expect(byLabel("Send feedback")).toBeNull();
  expect(byLabel("Settings")).not.toBeNull();
});
