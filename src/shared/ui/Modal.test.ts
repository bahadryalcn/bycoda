import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { ModalActions, ModalPanel } from "./Modal";
import { floatingFrameClassName } from "./NativePopupHost";
import { Sheet } from "./Sheet";

describe("ModalPanel", () => {
  it("uses one opaque ground for default, explicit floating and centered workspace dialogs", () => {
    const props = { title: "Preview", onClose: vi.fn(), children: "Body" };
    for (const surface of [undefined, "floating", "workspace-panel"] as const) {
      const markup = renderToStaticMarkup(createElement(ModalPanel, { ...props, surface }));
      expect(markup.match(/popover-backdrop/g)).toHaveLength(1);
      expect(markup).toContain(floatingFrameClassName);
    }
    const docked = renderToStaticMarkup(
      createElement(ModalPanel, { ...props, surface: "workspace-panel", placement: "end" }),
    );
    expect(docked).toContain("bg-(--ui-surface-panel)");
    expect(docked).not.toContain("popover-backdrop");
  });
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

  it("uses the shared raised surface and compact title at every size", () => {
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
    expect(compact).toContain('data-size="page"');
    expect(render({ size: "md" })).toContain('data-size="page"');
    expect(render({ size: "lg" })).toContain('data-size="page"');
    const sheet = render({ size: "lg", placement: "end" });
    expect(sheet).toContain('data-size="page"');
    expect(sheet).toContain("border-s");
    expect(sheet).toContain("rounded-none");
    expect(sheet).not.toContain("rounded-(--ui-radius-popup)");
  });

  it("keeps identical header, close, body padding and footer chrome across dialogs and sheets", () => {
    const props = { title: "Details", onClose: vi.fn(), footer: "Actions", children: "Body" };
    const variants = [
      ...(["sm", "md", "lg", "xl", "full"] as const).map((size) =>
        createElement(ModalPanel, { ...props, size }),
      ),
      ...(["end", "bottom"] as const).map((placement) =>
        createElement(ModalPanel, { ...props, placement }),
      ),
      createElement(Sheet, { ...props, modal: false, anchor: "container" }),
    ].map((element) => renderToStaticMarkup(element));
    const header = (markup: string) =>
      /<header[\s\S]*?<\/header>/.exec(markup)![0]
        .replace(/id="[^"]*"/g, 'id="title"')
        // A non-modal sheet advertises Esc on its close button.
        .replace(' data-tooltip-owner=""', "");
    const footer = (markup: string) => /<footer[^>]*>/.exec(markup)![0];
    for (const markup of variants) {
      expect(header(markup)).toBe(header(variants[0]));
      expect(footer(markup)).toBe(footer(variants[0]));
      expect(markup).toContain("px-4 pt-2 pb-4");
    }
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
    expect(markup.slice(footer)).toContain("overflow-y-auto");
  });

  it("can associate the visible blocker directly with its action", () => {
    const markup = renderToStaticMarkup(
      createElement(
        ModalActions,
        { reason: "Review required", reasonId: "review-blocker" },
        createElement(
          Button,
          { "aria-disabled": true, "aria-describedby": "review-blocker" },
          "Save",
        ),
      ),
    );
    expect(markup).toContain('id="review-blocker"');
    expect(markup).toContain('aria-describedby="review-blocker"');
    expect(markup.match(/Review required/g)).toHaveLength(1);
  });

  it("owns the body padding by default and drops it with padding none or scroll none", () => {
    const body = (props: Record<string, unknown>) => {
      const markup = renderToStaticMarkup(
        createElement(ModalPanel, {
          title: "T",
          onClose: vi.fn(),
          children: "Body",
          ...props,
        }),
      );
      return /<div[^>]*data-modal-scroll[^>]*>/.exec(markup)![0];
    };
    expect(body({})).toContain("px-4 pt-2 pb-4");
    expect(body({ padding: "md" })).toContain("px-4 pt-2 pb-4");
    expect(body({ padding: "none" })).not.toContain("px-4 pt-2 pb-4");
    expect(body({ scroll: "none" })).not.toContain("px-4 pt-2 pb-4");
    expect(body({ scroll: "none", padding: "md" })).toContain("px-4 pt-2 pb-4");
  });
});

describe("ModalPanel geometry variants", () => {
  const props = { title: "Panel", onClose: vi.fn(), children: "Body" };
  const render = (extra: object) =>
    renderToStaticMarkup(createElement(ModalPanel, { ...props, ...extra }));

  it("maps height to one working height per name", () => {
    expect(render({})).not.toContain(" h-[");
    expect(render({ height: "tall" })).toContain("h-[min(760px,85dvh)]");
    expect(render({ height: "fill" })).toContain("h-[calc(100dvh-32px)]");
  });

  it("gives Settings one geometry, the shared frame and a narrow end-edge peek", () => {
    const standard = render({ size: "settings" });
    expect(standard).toContain("w-[min(88rem,calc(100vw-24px))]");
    expect(standard).toContain("h-[min(60rem,calc(100dvh-32px))]");
    expect(standard).toContain(floatingFrameClassName);
    expect(standard).not.toContain("--modal-frame-color");
    const maximized = render({ size: "settings", maximized: true });
    expect(maximized).toContain("w-[calc(100vw-24px)]");
    expect(maximized).toContain("h-[calc(100dvh-32px)]");
    expect(render({ size: "settings", placement: "end" })).toContain("w-[min(380px,100vw)]");
  });

  it("places the minimal-header close button on the logical end edge", () => {
    const markup = render({ minimalHeader: true });
    expect(markup).toContain("inset-e-(--modal-close-inset)");
    expect(markup).not.toContain("right-3");
    expect(markup).toContain("--modal-close-clearance");
  });
});
