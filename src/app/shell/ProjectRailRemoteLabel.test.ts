// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectRail } from "./ProjectRail";
import { setLanguagePreference } from "../../shared/i18n/core";

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
    path === "/srv/app" ? { environmentId: "env-1", cwd: "/srv/app" } : undefined,
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
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(ProjectRail, {
          cwd: "~",
          recents: [{ path: "/srv/app", openedAt: 1 }],
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
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
