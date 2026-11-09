import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";

type FakeAddon = {
  dispose: ReturnType<typeof vi.fn>;
  contextLoss: Array<() => void>;
  lose: () => void;
};

const webgl = vi.hoisted(() => ({
  addons: [] as FakeAddon[],
  constructFailures: 0,
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    dispose = vi.fn();
    contextLoss: Array<() => void> = [];
    constructor() {
      if (webgl.constructFailures > 0) {
        webgl.constructFailures -= 1;
        throw new Error("WebGL2 not supported");
      }
      webgl.addons.push(this as unknown as FakeAddon);
    }
    onContextLoss(handler: () => void) {
      this.contextLoss.push(handler);
      return { dispose() {} };
    }
    lose() {
      for (const handler of this.contextLoss) handler();
    }
  },
}));

import { createTerminalWebgl, WEBGL_IDLE_DROP_MS } from "./terminalWebgl";
import { fitTerminal } from "../model/terminalLayout";

// Everything a PTY bridge hangs off the terminal. The renderer adapter must
// never touch any of it: it only loads/drops render resources.
function fakeTerminal() {
  const pty = {
    onData: vi.fn(),
    onResize: vi.fn(),
    onBinary: vi.fn(),
    write: vi.fn(),
    paste: vi.fn(),
    input: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
    reset: vi.fn(),
  };
  const loadAddon = vi.fn();
  const refresh = vi.fn();
  const term = { rows: 24, cols: 80, loadAddon, refresh, ...pty } as unknown as Terminal;
  return { term, loadAddon, refresh, pty };
}

function expectNoPtyTraffic(pty: ReturnType<typeof fakeTerminal>["pty"]) {
  for (const callback of Object.values(pty)) expect(callback).not.toHaveBeenCalled();
}

beforeEach(() => {
  webgl.addons.length = 0;
  webgl.constructFailures = 0;
});

describe("terminal WebGL renderer adapter", () => {
  it("refits the same terminal after renderer cell metrics change without a host resize", async () => {
    const { term, loadAddon, refresh } = fakeTerminal();
    let cell = { width: 8, height: 12 };
    Object.assign(term, {
      options: { lineHeight: 1, letterSpacing: 0 },
      _core: {
        _renderService: {
          dimensions: {
            css: {
              get cell() {
                return cell;
              },
            },
          },
        },
      },
      resize(cols: number, rows: number) {
        this.cols = cols;
        this.rows = rows;
      },
    });
    const host = { clientWidth: 114, clientHeight: 100 } as HTMLElement;
    const fit = () => fitTerminal(term, host, "shell");
    fit();
    expect([term.cols, term.rows]).toEqual([12, 8]);
    loadAddon.mockImplementation(() => {
      cell = { width: 10, height: 15 };
    });
    const adapter = createTerminalWebgl(
      term,
      () => true,
      () => {
        fit();
      },
    );

    await adapter.load();
    expect([term.cols, term.rows]).toEqual([10, 6]);
    expect(refresh).toHaveBeenLastCalledWith(0, 5);

    // Losing WebGL switches back to DOM metrics on the same running terminal.
    webgl.addons[0].dispose.mockImplementation(() => {
      cell = { width: 8, height: 12 };
    });
    webgl.addons[0].lose();
    expect([term.cols, term.rows]).toEqual([12, 8]);
    adapter.dispose();
  });

  it("loads one addon, refreshes the full grid, and ignores repeat or concurrent loads", async () => {
    const { term, loadAddon, refresh, pty } = fakeTerminal();
    const adapter = createTerminalWebgl(term, () => true);

    await Promise.all([adapter.load(), adapter.load()]);
    await adapter.load();

    expect(webgl.addons).toHaveLength(1);
    expect(loadAddon).toHaveBeenCalledExactlyOnceWith(webgl.addons[0]);
    expect(refresh).toHaveBeenCalledExactlyOnceWith(0, 23);
    expectNoPtyTraffic(pty);
  });

  it("does not load while the terminal cannot render, and loads once it can", async () => {
    const { term, loadAddon } = fakeTerminal();
    let visible = false;
    const adapter = createTerminalWebgl(term, () => visible);

    await adapter.load();
    expect(loadAddon).not.toHaveBeenCalled();
    expect(webgl.addons).toHaveLength(0);

    visible = true;
    await adapter.load();
    expect(loadAddon).toHaveBeenCalledOnce();
  });

  describe("load failure", () => {
    it("swallows an unsupported-WebGL constructor error and stays on the default renderer", async () => {
      const { term, loadAddon, refresh, pty } = fakeTerminal();
      const adapter = createTerminalWebgl(term, () => true);
      webgl.constructFailures = 1;

      await expect(adapter.load()).resolves.toBeUndefined();

      expect(loadAddon).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      expect(() => adapter.drop()).not.toThrow();
      expectNoPtyTraffic(pty);
    });

    it("swallows an addon activation error and allows a later retry", async () => {
      const { term, loadAddon, refresh, pty } = fakeTerminal();
      const adapter = createTerminalWebgl(term, () => true);
      loadAddon.mockImplementationOnce(() => {
        throw new Error("context creation failed");
      });

      await expect(adapter.load()).resolves.toBeUndefined();
      expect(refresh).not.toHaveBeenCalled();
      // Nothing is held, so drop has nothing to dispose and cannot throw.
      expect(() => adapter.drop()).not.toThrow();

      await adapter.load();
      expect(webgl.addons).toHaveLength(2);
      expect(loadAddon).toHaveBeenCalledTimes(2);
      expect(refresh).toHaveBeenCalledOnce();
      adapter.drop();
      expect(webgl.addons[1].dispose).toHaveBeenCalledOnce();
      expectNoPtyTraffic(pty);
    });

    it("recovers on the next load after a constructor failure", async () => {
      const { term, loadAddon } = fakeTerminal();
      const adapter = createTerminalWebgl(term, () => true);
      webgl.constructFailures = 1;

      await adapter.load();
      await adapter.load();

      expect(loadAddon).toHaveBeenCalledExactlyOnceWith(webgl.addons[0]);
    });
  });

  describe("context loss", () => {
    it("disposes the lost addon once and keeps the terminal usable without PTY traffic", async () => {
      const { term, loadAddon, refresh, pty } = fakeTerminal();
      const adapter = createTerminalWebgl(term, () => true);
      await adapter.load();
      const [addon] = webgl.addons;

      addon.lose();

      expect(addon.dispose).toHaveBeenCalledOnce();
      // Dropping or disposing afterwards must not dispose the dead addon again.
      adapter.drop();
      adapter.dispose();
      expect(addon.dispose).toHaveBeenCalledOnce();
      // The fallback renderer is xterm's own: no extra addon, no forced reload.
      expect(loadAddon).toHaveBeenCalledOnce();
      expect(refresh).toHaveBeenCalledOnce();
      expectNoPtyTraffic(pty);
    });

    it("can load a fresh renderer after a loss", async () => {
      const { term, loadAddon, refresh, pty } = fakeTerminal();
      const adapter = createTerminalWebgl(term, () => true);
      await adapter.load();
      webgl.addons[0].lose();

      await adapter.load();

      expect(webgl.addons).toHaveLength(2);
      expect(loadAddon).toHaveBeenLastCalledWith(webgl.addons[1]);
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(webgl.addons[1].dispose).not.toHaveBeenCalled();
      expectNoPtyTraffic(pty);
    });

    it("a late loss from a replaced addon does not drop the current renderer", async () => {
      const { term } = fakeTerminal();
      const adapter = createTerminalWebgl(term, () => true);
      await adapter.load();
      adapter.drop();
      await adapter.load();
      const [stale, current] = webgl.addons;
      expect(stale.dispose).toHaveBeenCalledOnce();

      stale.lose();
      expect(current.dispose).not.toHaveBeenCalled();
      // The current addon is still tracked, so another load is a no-op.
      await adapter.load();
      expect(webgl.addons).toHaveLength(2);

      adapter.drop();
      expect(current.dispose).toHaveBeenCalledOnce();
    });
  });

  describe("drop and dispose", () => {
    it("drop releases the addon once and a later load recreates it", async () => {
      const { term, loadAddon, pty } = fakeTerminal();
      const adapter = createTerminalWebgl(term, () => true);
      await adapter.load();

      adapter.drop();
      adapter.drop();
      expect(webgl.addons[0].dispose).toHaveBeenCalledOnce();

      await adapter.load();
      expect(loadAddon).toHaveBeenCalledTimes(2);
      expectNoPtyTraffic(pty);
    });

    it("dispose releases the addon and refuses later loads", async () => {
      const { term, loadAddon, pty } = fakeTerminal();
      const adapter = createTerminalWebgl(term, () => true);
      await adapter.load();

      adapter.dispose();
      await adapter.load();

      expect(webgl.addons).toHaveLength(1);
      expect(webgl.addons[0].dispose).toHaveBeenCalledOnce();
      expect(loadAddon).toHaveBeenCalledOnce();
      expectNoPtyTraffic(pty);
    });

    it("dispose while the addon module is still loading prevents any addon from attaching", async () => {
      const { term, loadAddon, refresh, pty } = fakeTerminal();
      const adapter = createTerminalWebgl(term, () => true);

      const pending = adapter.load();
      adapter.dispose();
      await pending;

      expect(webgl.addons).toHaveLength(0);
      expect(loadAddon).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      expectNoPtyTraffic(pty);
    });

    it("becoming invisible while the module loads prevents the attach", async () => {
      const { term, loadAddon } = fakeTerminal();
      let visible = true;
      const adapter = createTerminalWebgl(term, () => visible);

      const pending = adapter.load();
      visible = false;
      await pending;

      expect(loadAddon).not.toHaveBeenCalled();
      // The in-flight guard is released so a later visible load still works.
      visible = true;
      await adapter.load();
      expect(loadAddon).toHaveBeenCalledOnce();
    });
  });
  describe("delayed drop", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("keeps the renderer through a quick hide/show and drops it after the grace period", async () => {
      vi.useFakeTimers();
      const { term, loadAddon, pty } = fakeTerminal();
      let visible = true;
      const adapter = createTerminalWebgl(term, () => visible);
      await adapter.load();
      const [addon] = webgl.addons;

      // Quick toggles reuse the same context.
      for (let i = 0; i < 5; i++) {
        visible = false;
        adapter.dropSoon();
        vi.advanceTimersByTime(WEBGL_IDLE_DROP_MS / 2);
        visible = true;
        await adapter.load();
      }
      vi.advanceTimersByTime(WEBGL_IDLE_DROP_MS * 2);
      expect(addon.dispose).not.toHaveBeenCalled();
      expect(loadAddon).toHaveBeenCalledOnce();

      visible = false;
      adapter.dropSoon();
      vi.advanceTimersByTime(WEBGL_IDLE_DROP_MS);
      expect(addon.dispose).toHaveBeenCalledOnce();
      expectNoPtyTraffic(pty);
    });

    it("does not drop a terminal that is visible again when the timer fires", async () => {
      vi.useFakeTimers();
      const { term } = fakeTerminal();
      let visible = true;
      const adapter = createTerminalWebgl(term, () => visible);
      await adapter.load();

      visible = false;
      adapter.dropSoon();
      visible = true;
      vi.advanceTimersByTime(WEBGL_IDLE_DROP_MS);
      expect(webgl.addons[0].dispose).not.toHaveBeenCalled();
    });

    it("dispose cancels a pending drop and releases once", async () => {
      vi.useFakeTimers();
      const { term } = fakeTerminal();
      let visible = true;
      const adapter = createTerminalWebgl(term, () => visible);
      await adapter.load();

      visible = false;
      adapter.dropSoon();
      adapter.dispose();
      vi.advanceTimersByTime(WEBGL_IDLE_DROP_MS);
      expect(webgl.addons[0].dispose).toHaveBeenCalledOnce();
    });
  });

  it("frees the attached WebGL context when the renderer is dropped", async () => {
    const { term } = fakeTerminal();
    const loseContext = vi.fn();
    const gl = { getExtension: vi.fn(() => ({ loseContext })) };
    const existing = { getContext: vi.fn(() => null) };
    const glCanvas = { getContext: vi.fn(() => gl) };
    let canvases: unknown[] = [existing];
    Object.assign(term, { element: { querySelectorAll: () => canvases } });
    (term.loadAddon as ReturnType<typeof vi.fn>).mockImplementation(() => {
      canvases = [existing, glCanvas];
    });
    const adapter = createTerminalWebgl(term, () => true);
    await adapter.load();

    expect(existing.getContext).not.toHaveBeenCalled();
    adapter.drop();
    expect(webgl.addons[0].dispose).toHaveBeenCalledOnce();
    expect(gl.getExtension).toHaveBeenCalledWith("WEBGL_lose_context");
    expect(loseContext).toHaveBeenCalledOnce();
    adapter.drop();
    expect(loseContext).toHaveBeenCalledOnce();
  });
});
