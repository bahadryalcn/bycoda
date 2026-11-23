import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Session } from "../model/session";
import { RewoundHistoryDisclosure } from "./RewoundHistoryDisclosure";

const history = [
  {
    id: "rewind-1",
    createdAt: "2026-11-18T10:00:00.000Z",
    blocks: [{ id: "block-1", text: "First rewound prompt" }],
  },
  {
    id: "rewind-2",
    createdAt: "2026-11-18T10:05:00.000Z",
    blocks: [{ id: "block-2", text: "Second rewound prompt" }],
  },
] as unknown as NonNullable<Session["rewindHistory"]>;

function markupFor(truncated = false) {
  return renderToStaticMarkup(createElement(RewoundHistoryDisclosure, { history, truncated }));
}

describe("RewoundHistoryDisclosure scroll ownership", () => {
  it("does not make the whole disclosure a fixed-height nested scroller", () => {
    const markup = markupFor();
    const details = markup.match(/<details[^>]*>/)?.[0] ?? "";

    expect(details).toContain("data-rewind-history");
    expect(details).not.toMatch(/max-h-64/);
    expect(details).not.toMatch(/overflow-y-auto/);
  });

  it("caps the history list relative to the session pane and scrolls only that list", () => {
    const markup = markupFor();
    const region = markup.match(/<div[^>]*role="region"[^>]*>/)?.[0] ?? "";

    expect(region).toContain("max-h-[min(16rem,40cqb)]");
    expect(region).toContain("overflow-y-auto");
    expect(region).toContain("overscroll-contain");
  });

  it("keeps the region keyboard reachable and named after the summary", () => {
    const region = markupFor().match(/<div[^>]*role="region"[^>]*>/)?.[0] ?? "";

    expect(region).toContain('tabindex="0"');
    expect(region).toContain('aria-label="Rewound history (2)"');
  });

  it("keeps the summary row outside the scrolling region", () => {
    const markup = markupFor();
    const summaryAt = markup.indexOf("<summary");
    const regionAt = markup.indexOf('role="region"');

    expect(summaryAt).toBeGreaterThan(-1);
    expect(regionAt).toBeGreaterThan(summaryAt);
    expect(markup.slice(summaryAt, regionAt)).not.toContain("First rewound prompt");
  });

  it("marks a truncated preview with a quiet ellipsis outside the scroller, not a sentence", () => {
    const markup = markupFor(true);
    const noteAt = markup.indexOf("…");
    const regionAt = markup.indexOf('role="region"');

    expect(markup).not.toContain("Showing a preview of rewound history.");
    expect(noteAt).toBeGreaterThan(-1);
    expect(noteAt).toBeLessThan(regionAt);
  });
});
