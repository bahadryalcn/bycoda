import { withQueryClient } from "../../../tests/browser/support/queryTest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UsageFooter as QueryComponent } from "./UsageFooter";

vi.mock("../../features/settings/public/useKeybindingShortcut", () => ({
  useKeybindingShortcut: (command: string) => (command === "Terminal: New" ? "Alt+Shift+T" : null),
}));

describe("UsageFooter terminal control", () => {
  it("shows the live Terminal: New binding instead of the hard-coded MOD shortcut", () => {
    const markup = renderToStaticMarkup(
      createElement(UsageFooter, { providers: [], onNewTerminal: vi.fn() }),
    );
    expect(markup).toContain("Alt+Shift+T");
    expect(markup).not.toContain("+`");
  });

  it("keeps the overflowing provider strip scrollbar visible, not hidden", () => {
    const markup = renderToStaticMarkup(
      createElement(UsageFooter, { providers: [], onNewTerminal: vi.fn() }),
    );
    expect(markup).toContain("data-provider-usage");
    // ScrollArea marks a hidden bar with data-scrollbar="hidden"; the shared default omits it.
    expect(markup).not.toContain('data-scrollbar="hidden"');
  });

  it("replaces the generic terminal button with the live process control", () => {
    const markup = renderToStaticMarkup(
      createElement(UsageFooter, {
        providers: [],
        terminals: [
          {
            id: "terminal-1",
            process: "npm",
            cwd: "/repo",
            label: "repo",
          },
        ],
        terminalOpen: true,
        onToggleTerminal: vi.fn(),
        onNewTerminal: vi.fn(),
        onShowTerminal: vi.fn(),
        projectTerminalActive: true,
      }),
    );

    expect(markup).toContain(">npm</span>");
    expect(markup).not.toContain(">Terminal</span>");
    expect(markup.match(/<button/g)).toHaveLength(1);
  });

  it("keeps the generic terminal button when no process is running", () => {
    const markup = renderToStaticMarkup(
      createElement(UsageFooter, {
        providers: [],
        onNewTerminal: vi.fn(),
      }),
    );

    expect(markup).toContain('aria-label="New Terminal');
    expect(markup.match(/<button/g)).toHaveLength(1);
  });

  it("places conversation tools to the left of the terminal button", () => {
    const markup = renderToStaticMarkup(
      createElement(UsageFooter, {
        providers: [],
        onNewTerminal: vi.fn(),
        tools: { cwd: "/repo", sessionId: "session-1", title: "Chat" },
      }),
    );

    const tools = markup.indexOf('aria-label="Conversation tools"');
    expect(tools).toBeGreaterThan(-1);
    expect(tools).toBeLessThan(markup.indexOf('aria-label="New Terminal'));
  });

  it("keeps an unavailable terminal visible and explains why", () => {
    const reason = "Open this project on its machine to use the terminal.";
    const markup = renderToStaticMarkup(
      createElement(UsageFooter, { providers: [], terminalUnavailableReason: reason }),
    );
    expect(markup.match(/<button/g)).toHaveLength(1);
    // `disabledReason` keeps the control focusable (aria-disabled) so keyboard users reach the reason.
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain(`aria-description="${reason}"`);
    // The reason rides in the shared tooltip on hover, never a native title bubble.
    expect(markup).not.toContain("title=");
    expect(markup).toContain('aria-label="Terminal"');
  });

  it("does not highlight a saved terminal while its panel is hidden", () => {
    const markup = renderToStaticMarkup(
      createElement(UsageFooter, {
        providers: [],
        onShowTerminal: vi.fn(),
        projectTerminalActive: true,
        projectTerminalVisible: false,
      }),
    );
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).not.toContain("bg-selection");
  });
});

const UsageFooter = withQueryClient(QueryComponent);
