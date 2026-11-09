// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readGeneratorValue,
  resetGeneratorSession,
  useGeneratorState,
  writeGeneratorValue,
} from "./themeGeneratorSession";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetGeneratorSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("theme generator session", () => {
  it("keeps state across closing and reopening the generator", () => {
    let setPrompt: (value: string) => void = () => {};
    const seen: string[] = [];
    const Probe = () => {
      const [prompt, set] = useGeneratorState("prompt", "");
      setPrompt = set;
      seen.push(prompt);
      return null;
    };
    const host = document.createElement("div");
    const first = createRoot(host);
    act(() => first.render(createElement(Probe)));
    act(() => setPrompt("house of sauron"));
    act(() => first.unmount());

    const second = createRoot(document.createElement("div"));
    act(() => second.render(createElement(Probe)));
    expect(seen.at(-1)).toBe("house of sauron");
    act(() => second.unmount());
  });

  it("accepts writes while closed, so a drawing that finishes later is still shown", () => {
    writeGeneratorValue<Record<number, string>>(
      "chipImages",
      (current) => ({ ...current, 1: "done" }),
      {},
    );
    expect(readGeneratorValue("chipImages", {})).toEqual({ 1: "done" });
  });

  it("returns the same seeded value on every read so snapshots stay stable", () => {
    const first = readGeneratorValue("suggestions", () => []);
    expect(readGeneratorValue("suggestions", () => [])).toBe(first);
  });
});
