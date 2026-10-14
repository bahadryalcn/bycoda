// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { InboxView } from "./InboxView";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

it("offers a dedicated pull request view with sorting and project entry", () => {
  const markup = renderToStaticMarkup(
    createElement(InboxView, {
      pullRequestsOnly: true,
      cwd: "",
      recents: [],
      onAsk: async () => "session",
      onAskRestart: async () => "session",
      onAskMount: () => {},
      onOpenIntegrations: () => {},
      onOpenProject: () => {},
    }),
  );
  expect(markup).toContain("Pull Requests");
  expect(markup).toContain('aria-label="Sort pull requests"');
  expect(markup).toContain("Add project");
  expect(markup).not.toContain("Find the next step");
});
