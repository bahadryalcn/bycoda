// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { InboxItem } from "../model/githubTasks";
import { InboxCard } from "./InboxCard";

vi.mock("../../../shared/i18n", async (original) => ({
  ...(await original<object>()),
  useLocale: () => "tr",
  t: (value: string) => (value === "Assigned to you" ? "Size atandı" : value),
}));
vi.mock("../model/inboxSeen", () => ({ useInboxItemUnseen: () => false }));

describe("InboxCard attention", () => {
  it.each(["gitlab", "azuredevops"] as const)(
    "renders translated attention visibly for %s",
    (provider) => {
      const item: InboxItem = {
        provider,
        kind: "issue",
        title: "Example",
        repo: "team/project",
        number: 1,
        url: "https://example.com/1",
        state: "open",
        updatedAt: "2026-01-01T00:00:00Z",
        labels: [],
        assignees: [],
        draft: false,
        projectPath: "",
        attentionReason: "assigned",
      };
      const root = document.createElement("div");
      root.innerHTML = renderToStaticMarkup(
        createElement(InboxCard, {
          item,
          active: false,
          logoPath: null,
          mascotName: null,
          mascotColor: "",
          relatedSessionCount: 0,
          onSelect: () => {},
        }),
      );
      expect(root.textContent).toContain("Size atandı");
      expect(root.querySelector("button")?.getAttribute("aria-label")).toContain("Size atandı");
    },
  );
});
