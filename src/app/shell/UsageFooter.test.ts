import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UsageFooter } from "./UsageFooter";

describe("UsageFooter terminal control", () => {
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

    expect(markup).toContain(">Terminal</span>");
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

    const tools = markup.indexOf(">Conversation tools</span>");
    expect(tools).toBeGreaterThan(-1);
    expect(tools).toBeLessThan(markup.indexOf(">Terminal</span>"));
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
