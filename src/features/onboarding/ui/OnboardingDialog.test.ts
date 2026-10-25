// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  saveTerminalProviderAccount,
  setDefaultProviderAccount,
} from "../../providers/model/providerAccounts";
import OnboardingDialog from "./OnboardingDialog";
import type { ImportCandidate } from "../../../platform/tauri/sessionImport";
import { workspaceFeatureSettings } from "../../settings/model/workspaceFeatures";
import { loadCrewSceneEnabled, loadCrewTheme } from "../../settings/model/settings";
import { loadThemePreference } from "../../settings/model/appearance";
import { isPickerProviderVisible } from "../../sessions/model/models";

const mock = vi.hoisted(() => ({
  discover: vi.fn(),
  keys: vi.fn(),
  run: vi.fn(),
  pick: vi.fn(),
  remember: vi.fn(),
  available: vi.fn(),
  auth: vi.fn(),
}));
vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ children }: { children: unknown }) => children,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../../connections/ui/ConnectionsSettings", () => ({
  ConnectionsSettings: () => createElement("div", null, "Connection editor"),
}));
vi.mock("../../connections/ui/AddRemoteProjectDialog", () => ({
  AddRemoteProjectDialog: () => null,
}));
vi.mock("../../connections/model/connections", () => ({
  useRemoteMachines: () => ({ machines: [] }),
}));
vi.mock("../../sessions/ui/HarnessIcon", () => ({ HarnessIcon: () => null }));
vi.mock("../../sessions/ui/ProviderSignInDialog", () => ({
  ProviderSignInDialog: ({
    harness,
    accountId,
    onSignedIn,
    onClose,
  }: {
    harness: string;
    accountId?: string;
    onSignedIn: () => void;
    onClose: () => void;
  }) =>
    createElement(
      "button",
      {
        "data-provider-account": accountId,
        onClick: () => {
          onSignedIn();
          onClose();
        },
      },
      `Complete login ${harness}`,
    ),
}));
vi.mock("./OnboardingCrewPreview", () => ({ OnboardingCrewPreview: () => null }));
vi.mock("../../providers/ui/GenericAcpSettings", () => ({
  GenericAcpSettings: () => createElement("div", null, "Custom agent editor"),
}));
vi.mock("../../settings/ui/ProviderBinarySettings", () => ({
  ProviderBinaryControl: ({
    inline,
    onPathSaved,
  }: {
    inline?: boolean;
    onPathSaved?: () => void;
  }) => (inline ? createElement("button", { onClick: onPathSaved }, "Save fixture path") : null),
}));
vi.mock("../../settings/ui/TerminalProfileDiscovery", () => ({
  TerminalProfileDiscovery: () => null,
}));
vi.mock("../../../integrations/harness/core/authStatus", () => ({
  readHarnessAuthStatus: mock.auth,
}));
vi.mock("../../../integrations/harness/core/availability", () => ({
  getHarnessAvailabilitySnapshot: () => 0,
  subscribeHarnessAvailability: () => () => {},
  isHarnessAvailable: mock.available,
  probeHarnessAvailability: () => Promise.resolve(),
}));
vi.mock("../../../platform/tauri/sessionImport", () => ({
  discoverImportableSessions: mock.discover,
}));
vi.mock("../../sessions/data/sessionStore", () => ({
  importedSessionKeys: mock.keys,
}));
vi.mock("../../sessions/import/importRunner", () => ({
  isUsableProjectFolder: (item: ImportCandidate) => item.cwdExists,
  runSessionImport: mock.run,
}));
vi.mock("../../../platform/tauri/fs", () => ({ pickFolders: mock.pick }));
vi.mock("../../projects/model/recents", () => ({
  rememberProject: mock.remember,
}));

function candidate(id: string, overrides: Partial<ImportCandidate> = {}): ImportCandidate {
  return {
    provider: "codex",
    path: `${id}.jsonl`,
    providerSessionId: id,
    cwd: "G:/app",
    cwdExists: true,
    resumable: true,
    firstPrompt: "Hello",
    startedAt: 1,
    lastAt: 2,
    sizeBytes: 10,
    kind: "interactive",
    archived: false,
    ...overrides,
  };
}
let root: Root;
let container: HTMLDivElement;
const onFinish = vi.fn();
const onImported = vi.fn();
function button(text: string) {
  const found = [...container.querySelectorAll("button")].find(
    (item) => !item.closest("[hidden]") && item.textContent?.includes(text),
  );
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function render() {
  await act(async () =>
    root.render(
      createElement(OnboardingDialog, {
        onFinish,
        onImported,
        onOpenProject: vi.fn(),
      }),
    ),
  );
}
async function projects() {
  await render();
  await click("Projects");
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  localStorage.clear();
  mock.available.mockReturnValue(false);
  mock.auth.mockResolvedValue("unknown");
  mock.discover.mockResolvedValue({
    candidates: [
      candidate("a"),
      candidate("b"),
      candidate("stored"),
      candidate("missing", { cwdExists: false }),
      candidate("auto", { kind: "exec" }),
    ],
  });
  mock.keys.mockResolvedValue(["codex:stored"]);
  mock.run.mockResolvedValue({
    imported: 2,
    projects: 1,
    failed: [],
    cancelled: false,
    readOnly: 0,
    truncated: 0,
  });
  mock.pick.mockResolvedValue(["G:/new-project"]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
describe("onboarding workflow", () => {
  it("can skip without scanning or importing history", async () => {
    await render();
    await click("Set up later");
    expect(onFinish).toHaveBeenCalledOnce();
    expect(mock.discover).not.toHaveBeenCalled();
    expect(mock.run).not.toHaveBeenCalled();
  });
  it("imports only interactive, usable, unimported sessions in selected folders", async () => {
    await projects();
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    await click("Import 1 projects");
    expect(
      mock.run.mock.calls[0][0].candidates.map((item: ImportCandidate) => item.providerSessionId),
    ).toEqual(["a", "b"]);
    expect(onImported).toHaveBeenCalledOnce();
    expect(onFinish).not.toHaveBeenCalled();
    await click("Finish setup");
    expect(onFinish).toHaveBeenCalledOnce();
  });
  it("allows starting without importing any project", async () => {
    await projects();
    await click("Select none");
    await click("Finish setup");
    expect(mock.run).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledOnce();
  });
  it("blocks leaving during import and exposes cancellation", async () => {
    let resolve!: (value: unknown) => void;
    mock.run.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await projects();
    await click("Import 1 projects");
    expect(button("Import 1 projects").getAttribute("aria-busy")).toBe("true");
    await click("Import 1 projects");
    expect(mock.run).toHaveBeenCalledOnce();
    expect(button("Back").disabled).toBe(true);
    expect(button("Skip import").disabled).toBe(true);
    const signal = mock.run.mock.calls[0][0].signal as AbortSignal;
    await click("Cancel import");
    expect(signal.aborted).toBe(true);
    await act(async () =>
      resolve({
        imported: 0,
        projects: 0,
        failed: [],
        cancelled: true,
        readOnly: 0,
        truncated: 0,
      }),
    );
    expect(container.textContent).toContain("Import cancelled");
    expect(button("Back").disabled).toBe(false);
  });
  it("reports a failed discovery and still allows adding a folder", async () => {
    mock.discover.mockRejectedValue(new Error("Access denied"));
    await projects();
    expect(container.textContent).toContain("Access denied");
    await click("Choose project folders");
    expect(mock.remember).toHaveBeenCalledWith("G:/new-project");
    expect(onImported).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("1 project folders added");
  });
  it("keeps import failures visible for review before finishing", async () => {
    mock.run.mockResolvedValue({
      imported: 1,
      projects: 1,
      failed: [{ candidate: candidate("b"), error: "Transcript unreadable" }],
      cancelled: false,
    });
    await projects();
    await click("Import 1 projects");
    expect(container.textContent).toContain("Transcript unreadable");
    expect(onFinish).not.toHaveBeenCalled();
  });
  it("persists workspace choices and reuses them when setup reopens", async () => {
    await render();
    const checkbox = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ].find((input) => input.closest("label")?.textContent?.includes("Tasks"))!;
    await act(async () => checkbox.click());
    expect(workspaceFeatureSettings.tasks.load()).toBe(false);
    await act(async () => root.render(null));
    await render();
    const restored = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ].find((input) => input.closest("label")?.textContent?.includes("Tasks"))!;
    expect(restored.checked).toBe(false);
  });
  it("applies light and dark modes immediately and preserves crew selection while disabled", async () => {
    await render();
    await click("Appearance");
    for (const mode of ["light", "dark", "system"]) {
      await act(async () =>
        container.querySelector<HTMLButtonElement>(`#onboarding-appearance-${mode}`)!.click(),
      );
      expect(loadThemePreference()).toBe(mode);
      if (mode !== "system")
        expect(document.documentElement.classList.contains("theme-light")).toBe(mode === "light");
    }
    await act(async () =>
      container
        .querySelector<HTMLInputElement>('input[name="onboarding-crew"][value="star-wars"]')!
        .click(),
    );
    expect(loadCrewTheme()).toBe("star-wars");
    expect(loadCrewSceneEnabled()).toBe(true);
    await act(async () =>
      container
        .querySelector<HTMLInputElement>('input[name="onboarding-crew"][value="lotr"]')!
        .click(),
    );
    expect(loadCrewTheme()).toBe("lotr");
    await act(async () =>
      container
        .querySelector<HTMLInputElement>('input[name="onboarding-crew"][value="star-wars"]')!
        .click(),
    );
    await act(async () =>
      container
        .querySelector<HTMLInputElement>('input[name="onboarding-crew"][value="none"]')!
        .click(),
    );
    expect(loadCrewSceneEnabled()).toBe(false);
    expect(loadCrewTheme()).toBe("star-wars");
  });
  it("shows installed providers without listing missing ones and preserves visibility choices", async () => {
    mock.available.mockImplementation((id: string) => id === "codex");
    await render();
    await click("Agents");
    expect(container.textContent).not.toContain("Signed in");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Use Codex"]')!.click(),
    );
    expect(isPickerProviderVisible("codex")).toBe(false);
    expect(container.querySelectorAll(".onboarding-agent")).toHaveLength(1);
    expect(container.textContent).not.toContain("Cursor");
    await click("Connections");
    await click("Agents");
    expect(container.textContent).not.toContain("Cursor");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Sign in to Codex"]')!.click(),
    );
    await click("Complete login codex");
    expect(container.textContent).toContain("Signed in");
    await act(async () => root.render(null));
    await render();
    await click("Agents");
    expect(container.textContent).not.toContain("Cursor");
    expect(isPickerProviderVisible("codex")).toBe(false);
  });
  it("detects an existing CLI login on a fresh browser without starting login", async () => {
    mock.available.mockImplementation((id: string) => id === "codex" || id === "claude");
    mock.auth.mockImplementation(async (id: string) => (id === "codex" ? "signedIn" : "signedOut"));
    await render();
    await click("Agents");
    expect(mock.auth).toHaveBeenCalledWith("codex", "default");
    const rows = [...container.querySelectorAll(".onboarding-agent")];
    const codex = rows.find((row) => row.textContent?.includes("Codex"))!;
    const claude = rows.find((row) => row.textContent?.includes("Claude"))!;
    expect(codex.textContent).toContain("Signed in");
    expect(codex.textContent).not.toContain("Sign in");
    expect(claude.textContent).toContain("not signed in");
    expect(
      [...claude.querySelectorAll("button")].some((node) => node.textContent === "Sign in"),
    ).toBe(true);
  });
  it("offers an empty state and adds a missing provider only after its path is saved", async () => {
    await render();
    await click("Agents");
    expect(container.querySelectorAll(".onboarding-agent")).toHaveLength(0);
    expect(container.textContent).toContain("No providers found");
    await click("Add provider");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Provider: Choose a provider…"]')!
        .click(),
    );
    const cursor = document.querySelector<HTMLButtonElement>(
      '[role="option"][data-value="cursor"]',
    )!;
    await act(async () => cursor.click());
    expect(container.querySelectorAll(".onboarding-agent")).toHaveLength(0);
    await click("Save fixture path");
    expect(container.querySelectorAll(".onboarding-agent")).toHaveLength(1);
    expect(container.textContent).toContain("Cursor");
    await click("Connections");
    await click("Agents");
    expect(container.textContent).toContain("Cursor");
  });
  it("keeps unknown authentication distinct from a signed-out account and refreshes it", async () => {
    mock.available.mockImplementation((id: string) => id === "codex");
    await render();
    await click("Agents");
    expect(container.textContent).toContain("sign-in status unavailable");
    expect(container.textContent).not.toContain("not signed in");
    mock.auth.mockResolvedValue("signedIn");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Refresh agent status"]')!.click(),
    );
    expect(container.textContent).toContain("Signed in");
  });
  it("ignores an old profile's scan and signs in to the newly selected profile", async () => {
    mock.available.mockImplementation((id: string) => id === "claude");
    let finishOld!: (status: string) => void;
    const oldScan = new Promise<string>((resolve) => {
      finishOld = resolve;
    });
    mock.auth.mockImplementation((_provider: string, accountId: string) =>
      accountId === "default" ? oldScan : Promise.resolve("signedOut"),
    );
    await render();
    await click("Agents");
    await act(async () => {
      saveTerminalProviderAccount({ provider: "claude", id: "terminal-work", label: "Work" });
      setDefaultProviderAccount("claude", "terminal-work");
    });
    expect(mock.auth).toHaveBeenCalledWith("claude", "terminal-work");
    await act(async () => finishOld("signedIn"));
    expect(container.textContent).not.toContain("Signed in");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Sign in to Claude Code"]')!.click(),
    );
    expect(container.querySelector('[data-provider-account="terminal-work"]')).not.toBeNull();
  });

  it("opens the existing connection editor without scanning history", async () => {
    await render();
    await click("Connections");
    await click("Manage connections");
    expect(container.textContent).toContain("Connection editor");
    expect(mock.discover).not.toHaveBeenCalled();
  });
  it("retains project selections and added folders when navigating back", async () => {
    await projects();
    await click("Select none");
    await click("Choose project folders");
    await click("Back");
    await click("Projects");
    expect(mock.discover).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLInputElement>(".onboarding-project input")?.checked).toBe(
      false,
    );
    expect(container.textContent).toContain("1 project folders added");
  });
});
