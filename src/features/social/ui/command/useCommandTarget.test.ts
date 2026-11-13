// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCommandTarget } from "./useCommandTarget";
let root: Root;
let state!: {
  text: string;
  setText: (text: string) => void;
  navigation: ReturnType<typeof useCommandTarget>;
};
function Probe({ target, active }: { target?: unknown; active: boolean }) {
  const [text, setText] = useState("");
  const navigation = useCommandTarget(target, active, text, setText);
  state = { text, setText, navigation };
  return null;
}
function render(target?: unknown, active = true) {
  act(() => root.render(createElement(Probe, { target, active })));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it("consumes navigation once, on activation, and permits repeated prompt text from a new occurrence", () => {
  const target = { prompt: "Plan this week" };
  render(target, false);
  expect(state.text).toBe("");
  render(target);
  expect(state.text).toBe("Plan this week");
  act(() => state.setText(""));
  render(target);
  expect(state.text).toBe("");
  render({ prompt: "Plan this week" });
  expect(state.text).toBe("Plan this week");
});

it("offers a new prompt without replacing local work and appends only on explicit acceptance", () => {
  render();
  act(() => state.setText("My work"));
  const target = { prompt: "Plan this week" };
  render(target);
  expect(state.text).toBe("My work");
  expect(state.navigation.prompt).toBe("Plan this week");
  act(() => state.navigation.apply());
  expect(state.text).toBe("My work\n\nPlan this week");
  expect(state.navigation.prompt).toBeUndefined();
  render(target);
  expect(state.text).toBe("My work\n\nPlan this week");
});

it("retains overlong prompts for review and ignores malformed targets", () => {
  render({ prompt: "x".repeat(2001) });
  expect(state.text).toBe("");
  expect(state.navigation.prompt).toHaveLength(2001);
  act(() => state.navigation.dismiss());
  render({ prompt: 3 });
  expect(state.navigation.prompt).toBeUndefined();
  render({ prompt: "  " });
  expect(state.text).toBe("");
});
