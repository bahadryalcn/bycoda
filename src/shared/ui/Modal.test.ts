import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModalPanel } from "./Modal";

describe("ModalPanel", () => {
  it("names the dialog and close action", () => {
    const markup = renderToStaticMarkup(
      createElement(ModalPanel, {
        title: "Example",
        description: "A reusable shell",
        onClose: vi.fn(),
        children: "Body",
      }),
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("modal-panel");
    expect(markup).toContain("Example");
    expect(markup).toContain("A reusable shell");
    expect(markup).toContain("Body");
    expect(markup).toContain('aria-label="Close"');
    expect(markup).toContain("max-h-[calc(100dvh-32px)]");
    expect(markup).toContain("ui-secondary-text mt-0.5 break-words");
  });

  it("can preserve an accessible title with a minimal visual header", () => {
    const markup = renderToStaticMarkup(
      createElement(ModalPanel, {
        title: "Authentication required",
        description: "Sign in to continue.",
        minimalHeader: true,
        onClose: vi.fn(),
        children: "Provider login",
      }),
    );

    expect(markup).toContain('class="sr-only"');
    expect(markup).toContain("Authentication required");
    expect(markup).toContain("Provider login");
  });

  it("uses the shared raised surface and a compact or task title by context", () => {
    const render = (props: Record<string, unknown>) =>
      renderToStaticMarkup(
        createElement(ModalPanel, {
          title: "Example",
          onClose: vi.fn(),
          children: "Body",
          ...props,
        }),
      );
    const compact = render({ size: "sm" });
    expect(compact).toContain("popover-backdrop");
    expect(compact).not.toContain("bg-background-base");
    expect(compact).toContain("text-ui-title");
    expect(render({ size: "md" })).toContain("text-ui-heading");
    expect(render({ size: "lg" })).toContain("text-ui-heading");
    const sheet = render({ size: "lg", placement: "end" });
    expect(sheet).toContain("text-ui-title");
    expect(sheet).toContain("border-s");
    expect(sheet).toContain("rounded-none");
    expect(sheet).not.toContain("rounded-(--ui-radius-popup)");
  });

  it("keeps the footer outside the scrolling body", () => {
    const markup = renderToStaticMarkup(
      createElement(ModalPanel, {
        title: "Example",
        onClose: vi.fn(),
        footer: "Actions",
        children: "Body",
      }),
    );
    const scroller = markup.indexOf("overflow-y-auto");
    const footer = markup.indexOf("<footer");
    expect(scroller).toBeLessThan(footer);
    expect(markup.slice(scroller, footer)).not.toContain("Actions");
  });
});
