// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SessionDiscussionPanel } from "./SessionDiscussionPanel";

vi.mock("../../../shared/hooks/useDragResize", () => ({
  useDragResize: () => ({ setPaneRef: () => {}, sashProps: {} }),
}));

it("ignores an old scope response after the panel is rebound or closed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const pending: ((id: string) => void)[] = [];
  const onOpen = vi.fn(() => new Promise<string>((resolve) => pending.push(resolve)));
  const onMount = vi.fn();
  const render = (scopeKey: string) =>
    root.render(
      createElement(SessionDiscussionPanel, {
        scopeKey,
        title: "Discussion",
        label: "Discussion",
        onOpen,
        onMount,
        onClose: () => {},
      }),
    );
  try {
    await act(async () => render("first"));
    await act(async () => render("second"));
    await act(async () => pending[0]!("stale"));
    expect(onMount.mock.calls.some(([portal]) => portal?.sessionId === "stale")).toBe(false);
    await act(async () => pending[1]!("current"));
    expect(onMount.mock.calls.some(([portal]) => portal?.sessionId === "current")).toBe(true);
    await act(async () => render("third"));
    await act(async () => root.unmount());
    await act(async () => pending[2]!("closed"));
    expect(onMount.mock.calls.some(([portal]) => portal?.sessionId === "closed")).toBe(false);
  } finally {
    element.remove();
    vi.unstubAllGlobals();
  }
});
