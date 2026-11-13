import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AssistantMemoryPanel } from "./AssistantMemoryPanel";
it.each(["", "missing"])("does not call a failed memory read empty for query %s", (query) => {
  const html = renderToStaticMarkup(
    createElement(AssistantMemoryPanel, {
      entries: [],
      ruleCount: 0,
      query,
      searching: false,
      pending: false,
      searchError: createElement("p", null, "Read failed"),
      errorFor: vi.fn(),
      onQuery: vi.fn(),
      onAdd: vi.fn(),
      onEdit: vi.fn(),
      onToggle: vi.fn(),
      onDelete: vi.fn(),
    }),
  );
  expect(html).toContain("Read failed");
  expect(html).not.toContain("Nothing saved here yet");
  expect(html).not.toContain("No results");
});
