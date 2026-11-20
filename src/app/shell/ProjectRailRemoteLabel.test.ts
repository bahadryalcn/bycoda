// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectRail } from "./ProjectRail";
import { setLanguagePreference } from "../../shared/i18n/core";
import { saveAutoTabGroupLabel } from "../../features/workspace/model/tabGroups";

const REMOTE_PATH = "remote://env-1/srv/app";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async () => undefined),
}));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: () => null,
  useProjectsDiffStats: () => new Map(),
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("../../features/projects/model/projectData", () => ({
  projectSessionCount: vi.fn(async () => 0),
}));
vi.mock("../../features/connections/public/useRemoteProject", () => ({
  useRemoteProject: (path: string) =>
    path === REMOTE_PATH ? { environmentId: "env-1", cwd: "/srv/app" } : undefined,
}));
vi.mock("../../features/connections/model/connections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../features/connections/model/connections")>()),
  useRemoteMachines: () => ({
    machines: [{ id: "m1", environmentId: "env-1", name: "Studio" }],
    loaded: true,
    loading: false,
    refresh: () => {},
  }),
  useRemoteMachineOnline: () => {},
}));
vi.mock("../../features/connections/model/useRemoteConnection", () => ({
  useRemoteConnection: () => ({ status: "connected", reconnecting: false }),
}));

afterEach(async () => {
  await setLanguagePreference("en");
});

it("translates the remote project row's accessible name instead of joining a literal English 'on'", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  await setLanguagePreference("tr");
  saveAutoTabGroupLabel(REMOTE_PATH, "app (tailm)");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(ProjectRail, {
          cwd: "~",
          recents: [{ path: REMOTE_PATH, openedAt: 1 }],
          onSelectProject: vi.fn(),
          onOpenProject: vi.fn(),
        }),
      ),
    );
    const labels = [...container.querySelectorAll("[aria-label]")].map((el) =>
      el.getAttribute("aria-label"),
    );
    expect(labels.some((label) => label?.includes("Studio üzerinde"))).toBe(true);
    expect(labels.some((label) => / on Studio/.test(label ?? ""))).toBe(false);
    const row = container.querySelector<HTMLButtonElement>("[data-project-primary]")!;
    expect(row.querySelector("[data-truncate]")?.textContent).toBe("app");
    expect(row.querySelector("svg.lucide-server")).not.toBeNull();
    await act(async () => row.focus());
    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip?.querySelector("svg.lucide-server")).not.toBeNull();
    expect(tooltip?.textContent).toContain("Studio üzerinde /srv/app");
    expect(tooltip?.textContent).not.toContain("tailm");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
