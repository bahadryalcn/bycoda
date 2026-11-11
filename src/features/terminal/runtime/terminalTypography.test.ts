// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";

vi.mock("./terminalTheme", () => ({ monoFont: () => '"Test Mono", monospace' }));

import { createTerminalTypography } from "./terminalTypography";
import { loadAppearancePreferences } from "../../settings/model/appearancePreferences";

class FakeFontSet extends EventTarget {
  pending: Array<() => void> = [];
  load = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        this.pending.push(resolve);
      }),
  );
}

function fakeTerminal() {
  const families: string[] = [];
  const raw = { fontFamily: '"Test Mono", monospace', fontSize: 13 };
  const options = {
    get fontFamily() {
      return raw.fontFamily;
    },
    set fontFamily(value: string) {
      // Like xterm: assigning the current value is not a change and measures nothing.
      if (value === raw.fontFamily) return;
      raw.fontFamily = value;
      families.push(value);
    },
    fontSize: raw.fontSize,
  };
  const clearTextureAtlas = vi.fn();
  const term = {
    options,
    clearTextureAtlas,
    attachCustomWheelEventHandler: vi.fn(),
  } as unknown as Terminal;
  return { term, families, clearTextureAtlas };
}

function create(term: Terminal, applySize: () => void) {
  return createTerminalTypography({
    term,
    host: document.createElement("div"),
    initialPreferences: loadAppearancePreferences(),
    typography: { current: {} },
    zoomSize: { current: null },
    onFontSizeChange: { current: undefined },
    onDisplayFontSize: () => undefined,
    onSavedFontSize: () => undefined,
    applySize,
  });
}

describe("terminal typography font loading", () => {
  let fonts: FakeFontSet;

  beforeEach(() => {
    fonts = new FakeFontSet();
    Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
  });

  afterEach(() => {
    Reflect.deleteProperty(document, "fonts");
  });

  it("re-measures the grid when the terminal font finishes loading", async () => {
    const { term, families, clearTextureAtlas } = fakeTerminal();
    const applySize = vi.fn();
    const typography = create(term, applySize);

    expect(fonts.load).toHaveBeenCalledWith('13px "Test Mono", monospace');
    expect(applySize).not.toHaveBeenCalled();

    fonts.pending[0]();
    await Promise.resolve();
    await Promise.resolve();

    // The family must really change and come back, or xterm keeps its stale cell size.
    expect(families).toEqual(["monospace", '"Test Mono", monospace']);
    expect(clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(applySize).toHaveBeenCalledTimes(1);

    fonts.dispatchEvent(new Event("loadingdone"));
    expect(applySize).toHaveBeenCalledTimes(2);

    typography.dispose();
    fonts.dispatchEvent(new Event("loadingdone"));
    expect(applySize).toHaveBeenCalledTimes(2);
  });

  it("works without the Font Loading API", () => {
    Reflect.deleteProperty(document, "fonts");
    const { term } = fakeTerminal();
    expect(() => create(term, vi.fn()).dispose()).not.toThrow();
  });
});
