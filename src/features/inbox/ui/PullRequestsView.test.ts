// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InboxView as RawInboxView } from "./InboxView";
import { withQueryClient } from "../../../../tests/browser/support/queryTest";
const InboxView = withQueryClient(RawInboxView);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []), isTauri: () => false }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
    onFocusChanged: async () => () => {},
    isFullscreen: async () => false,
  }),
}));
vi.mock("../model/githubTasks", async (original) => ({
  ...(await original<typeof import("../model/githubTasks")>()),
  listInboxItems: async () => ({ items: [], errors: {} }),
  peekInboxList: () => null,
  githubStatus: async () => ({ connected: true }),
}));

it("offers a dedicated pull request view with sorting and project entry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onOpenProject = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(InboxView, {
        pullRequestsOnly: true,
        cwd: "",
        recents: [],
        onAsk: async () => "session",
        onAskRestart: async () => "session",
        onAskMount: () => {},
        onOpenIntegrations: () => {},
        onOpenProject,
      }),
    ),
  );
  const markup = host.innerHTML;
  expect(markup).toContain("Pull Requests");
  // Sorting and filtering appear only once there is something to sort; the empty state shows the entry.
  expect(markup).not.toContain('aria-label="Sort pull requests"');
  expect(markup).not.toContain("Find the next step");
  // Project entry lives in the empty state once the view has loaded.
  const add = [...host.querySelectorAll("button")].find((b) => b.textContent === "Add project");
  expect(add).toBeDefined();
  await act(async () => add!.click());
  expect(onOpenProject).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
