// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Block } from "./session";
import { turnClockOrigin, useTurnClockOrigin } from "./turnActivity";

const owner = (over: Partial<Block>) => ({ id: "o1", role: "user", text: "hi", ...over }) as Block;

describe("useTurnClockOrigin", () => {
  it("returns exactly what turnClockOrigin returns and keeps it across renders", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const block = owner({ id: "origin-hook-1" });
    const seen: Array<number | undefined> = [];
    function Probe() {
      seen.push(useTurnClockOrigin(block));
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    act(() => root.render(createElement(Probe)));
    act(() => root.unmount());
    expect(seen[0]).toBeTypeOf("number");
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBe(turnClockOrigin(block));
    expect(turnClockOrigin(undefined)).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
