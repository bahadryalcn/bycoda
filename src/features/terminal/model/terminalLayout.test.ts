import { describe, expect, it } from "vitest";
import { fitTerminal, terminalScrollbarWidth } from "./terminalLayout";
import type { Terminal } from "@xterm/xterm";

it("fits shell rows using the configured spacing after leaving a stretched TUI", () => {
  const options = { lineHeight: 2, letterSpacing: 3 };
  const term = {
    options, cols: 80, rows: 24,
    resize(cols: number, rows: number) { this.cols = cols; this.rows = rows; },
    _core: { _renderService: { dimensions: { css: {
      get cell() { return { width: 10, height: 10 * options.lineHeight }; },
    } } } },
  };
  expect(fitTerminal(term as unknown as Terminal,
    { clientWidth: 114, clientHeight: 100 } as HTMLElement, "shell", 1.5))
    .toEqual({ cols: 10, rows: 6 });
  expect(options).toEqual({ lineHeight: 1.5, letterSpacing: 0 });
});

describe("terminalScrollbarWidth", () => {
  it("defaults to 14px when overview ruler width is unset", () => {
    expect(terminalScrollbarWidth(undefined)).toBe(14);
    expect(terminalScrollbarWidth({})).toBe(14);
  });

  it("honors an explicit overview ruler width", () => {
    expect(terminalScrollbarWidth({ width: 1 })).toBe(1);
    expect(terminalScrollbarWidth({ width: 0 })).toBe(0);
  });
});
