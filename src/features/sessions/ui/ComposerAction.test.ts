import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComposerAction } from "./Composer";

function renderAction(busy: boolean, hasValue: boolean, allowBusySubmit = true) {
  return renderToStaticMarkup(
    createElement(ComposerAction, {
      busy,
      hasValue,
      allowBusySubmit,
      onSend: vi.fn(),
      onStop: vi.fn(),
    }),
  );
}

describe("ComposerAction", () => {
  it("keeps Stop alongside Send when typing during a running turn", () => {
    const empty = renderAction(true, false);
    expect(empty).toContain('aria-label="Stop"');
    expect(empty).not.toContain('aria-label="Send"');

    const typed = renderAction(true, true);
    expect(typed).toContain('aria-label="Send"');
    expect(typed).toContain('data-button-variant="primary"');
    expect(typed).toContain('aria-label="Stop"');
    // Send/Stop hints (with their key caps) ride in the shared tooltip, never a native title.
    expect(typed).not.toContain(" title=");
  });

  it("keeps a blocked Send focusable and exposes its reason without renaming it", () => {
    const blocked = renderToStaticMarkup(
      createElement(ComposerAction, {
        busy: false,
        hasValue: true,
        disabled: true,
        blockedReason: "Host unavailable",
        onSend: vi.fn(),
        onStop: vi.fn(),
      }),
    );
    expect(blocked).toContain('aria-label="Send"');
    expect(blocked).toContain('aria-disabled="true"');
    expect(blocked).toContain('aria-description="Host unavailable"');
    expect(blocked).not.toMatch(/ disabled(=|>| )/);
  });

  it("explains an empty Send through the same focusable path", () => {
    const empty = renderToStaticMarkup(
      createElement(ComposerAction, {
        busy: false,
        hasValue: false,
        blockedReason: "Choose a model",
        onSend: vi.fn(),
        onStop: vi.fn(),
      }),
    );
    expect(empty).toContain('aria-label="Send"');
    expect(empty).toContain('aria-disabled="true"');
    expect(empty).toContain('aria-description="Choose a model"');
  });

  it("keeps Stop while busy when submitting follow-up text is disabled", () => {
    const typed = renderAction(true, true, false);
    expect(typed).toContain('aria-label="Stop"');
    expect(typed).not.toContain('aria-label="Send"');
  });
});
