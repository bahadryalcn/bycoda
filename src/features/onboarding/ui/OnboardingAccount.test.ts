// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shouldShowOnboarding } from "../model/onboarding";
import OnboardingDialog from "./OnboardingDialog";

type State = Record<string, unknown>;
const account = vi.hoisted(() => ({
  state: { phase: "signed-out", notice: null, message: null } as State,
  signIn: vi.fn(() => Promise.resolve()),
  cancelSignIn: vi.fn(() => Promise.resolve()),
  stats: "off" as "on" | "off" | null,
  setStats: vi.fn(),
}));
vi.mock("../../account", () => ({
  getStatsChoice: () => account.stats,
  setStatsChoice: account.setStats,
  subscribeAnonymousStats: () => () => undefined,
  useAccountState: () => account.state,
  useAccount: () => ({
    state: account.state,
    signIn: account.signIn,
    cancelSignIn: account.cancelSignIn,
  }),
}));
vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../connections/ui/ConnectionsSettings", () => ({ ConnectionsSettings: () => null }));
vi.mock("../../connections/ui/AddRemoteProjectDialog", () => ({
  AddRemoteProjectDialog: () => null,
}));
vi.mock("../../connections/model/connections", () => ({
  useRemoteMachines: () => ({ machines: [] }),
}));
vi.mock("../../sessions/ui/HarnessIcon", () => ({ HarnessIcon: () => null }));
vi.mock("../../sessions/ui/ProviderSignInDialog", () => ({ ProviderSignInDialog: () => null }));
vi.mock("./OnboardingCrewPreview", () => ({ OnboardingCrewPreview: () => null }));
vi.mock("./OnboardingAgents", () => ({ OnboardingAgents: () => null }));
vi.mock("./OnboardingPreferences", () => ({
  OnboardingWorkspace: () => createElement("h3", null, "Workspace body"),
  OnboardingAppearance: () => null,
}));
vi.mock("../../../platform/tauri/sessionImport", () => ({
  discoverImportableSessions: () => Promise.resolve({ candidates: [] }),
}));
vi.mock("../../sessions/import/importRunner", () => ({
  isUsableProjectFolder: () => true,
  runSessionImport: vi.fn(),
}));
vi.mock("../../sessions/data/sessionStore", () => ({
  importedSessionKeys: () => Promise.resolve([]),
}));
vi.mock("../../../platform/tauri/fs", () => ({ pickFolders: vi.fn() }));
vi.mock("../../projects/model/recents", () => ({ rememberProject: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
const KEY = "bycoda.onboarding.account.v1";
const text = () => container.textContent ?? "";
async function render() {
  await act(async () =>
    root.render(
      createElement(OnboardingDialog, {
        onFinish: vi.fn(),
        onImported: vi.fn(),
        onOpenProject: vi.fn(),
      }),
    ),
  );
}
async function click(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Button not found: ${label}`);
  await act(async () => found.click());
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  vi.clearAllMocks();
  account.state = { phase: "signed-out", notice: null, message: null };
  account.stats = "off";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("onboarding account step", () => {
  it("leads the first run with sign-in and a guest choice", async () => {
    await render();
    expect(text()).toContain("Sign in to sync your stats across devices");
    expect(text()).toContain("Sign in with browser");
    expect(text()).toContain("Continue as guest");
  });

  it("continues as guest, persists the choice and moves on to the local setup", async () => {
    await render();
    await click("Continue as guest");
    expect(text()).toContain("Workspace body");
    expect(localStorage.getItem(KEY)).not.toBeNull();
    expect(account.signIn).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(text()).not.toContain("Sign in to sync your stats");
  });

  it("asks about anonymous statistics after the account step until answered", async () => {
    account.stats = null;
    await render();
    await click("Continue as guest");
    expect(text()).toContain("Share anonymous statistics?");
    expect(text()).toContain("Never sent: your sessions, prompts, code");
    await click("Don't share");
    expect(account.setStats).toHaveBeenCalledWith("off");
    await click("Share anonymous statistics");
    expect(account.setStats).toHaveBeenCalledWith("on");
    await click("Continue");
    expect(text()).toContain("Workspace body");
  });

  it("starts the browser sign-in", async () => {
    await render();
    await click("Sign in with browser");
    expect(account.signIn).toHaveBeenCalledOnce();
  });

  it("offers cancel while waiting for the browser", async () => {
    account.state = { phase: "signing-in" };
    await render();
    await click("Cancel");
    expect(account.cancelSignIn).toHaveBeenCalledOnce();
  });

  it("shows success after sign-in and lets setup continue", async () => {
    account.state = {
      phase: "signed-in",
      context: { user: { displayName: "Ada", email: "ada@example.com" } },
    };
    await render();
    expect(text()).toContain("Signed in as Ada");
    await click("Continue");
    expect(text()).toContain("Workspace body");
  });

  it("returns to the step with the error and keeps the guest option on failure", async () => {
    account.state = { phase: "signed-out", notice: "sign-in-failed", message: "Network down" };
    await render();
    expect(text()).toContain("Network down");
    expect(text()).toContain("Continue as guest");
    account.state = { phase: "signed-out", notice: "declined", message: null };
    await render();
    expect(text()).toContain("Sign-in was cancelled.");
    expect(text()).toContain("Sign in with browser");
  });

  it("is hidden when accounts are not available in the build", async () => {
    account.state = { phase: "unavailable" };
    await render();
    expect(text()).not.toContain("Sign in to sync your stats");
    expect(text()).toContain("Workspace body");
  });

  it("does not interrupt users who already completed onboarding", () => {
    localStorage.setItem("bycoda.onboarding.v1", "complete");
    expect(
      shouldShowOnboarding({ projects: 0, sessions: 0, restored: false, transferred: false }),
    ).toBe(false);
  });
});
