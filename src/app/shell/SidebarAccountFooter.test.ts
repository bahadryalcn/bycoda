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
  vi.unstubAllEnvs();
});
const render = (props = {}) =>
  act(async () => root.render(createElement(SidebarAccountFooter, props)));
const byLabel = (label: string) => container.querySelector<HTMLElement>(`[aria-label="${label}"]`);

it.each([false, true])(
  "keeps the development marker inside footer actions (compact=%s)",
  async (compact) => {
    vi.stubEnv("DEV", true);
    await render({ compact });
    const marker = container.querySelector("[data-dev-mode-indicator]");
    expect(marker).not.toBeNull();
    expect(marker!.closest("[data-sidebar-account-footer]")).toBe(
      container.querySelector("[data-sidebar-account-footer]"),
    );
    expect(marker!.compareDocumentPosition(byLabel("View bycoda on GitHub")!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(marker!.getAttribute("aria-label")).toBe("Development build");
  },
);

it("omits the development marker in production", async () => {
  vi.stubEnv("DEV", false);
  await render();
  expect(container.querySelector("[data-dev-mode-indicator]")).toBeNull();
});

it("keeps the repository actions before Settings and account", async () => {
  const onOpenSettings = vi.fn();
  await render({ onOpenSettings });
  expect(byLabel("Account: Guest. Away")).not.toBeNull();
  await act(async () => byLabel("Settings")!.click());
  expect(onOpenSettings).toHaveBeenCalledOnce();
  expect(byLabel("Send feedback")).toBeNull();
  expect(byLabel("View bycoda on GitHub")).not.toBeNull();
  expect(byLabel("Dismiss GitHub repository prompt")).not.toBeNull();
  expect(container.querySelector('[aria-label^="Update"]')).toBeNull();
  expect(
    [...container.querySelectorAll("button")].map((button) => button.getAttribute("aria-label")),
  ).toEqual([
    "View bycoda on GitHub",
    "Dismiss GitHub repository prompt",
    "Settings",
    "Account: Guest. Away",
  ]);
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

it("stacks the compact variant with the same action order", async () => {
  await render({ compact: true });
  expect(container.querySelector('[data-sidebar-account-footer="compact"]')).not.toBeNull();
  expect(byLabel("Send feedback")).toBeNull();
  expect(byLabel("Settings")).not.toBeNull();
  expect(container.querySelector("[data-github-star-prompt][data-compact]")).not.toBeNull();
});

it("dismisses the repository prompt while retaining the update action", async () => {
  mocks.snapshot = { phase: "available", currentVersion: "1.0.0", availableVersion: "1.1.0" };
  await render({ compact: true });
  act(() => byLabel("Dismiss GitHub repository prompt")!.click());
  expect(byLabel("View bycoda on GitHub")).toBeNull();
  expect(byLabel("Update to 1.1.0")).not.toBeNull();
  expect(byLabel("Settings")).not.toBeNull();
});
