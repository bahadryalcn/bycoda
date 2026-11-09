// @vitest-environment happy-dom
import { act, createElement, useRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import { GlobalSessionListWindow } from "./GlobalSessionListWindow";

const makeSessions = (): SessionSummary[] =>
  Array.from({ length: 1000 }, (_, index) => ({
    id: `session-${index % 500}`,
    cwd: index < 500 ? "/workspace/one" : "/workspace/two",
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
    title: `Conversation ${index}`,
    createdAt: 1,
    updatedAt: 1000 - index,
  }));

function Window({ sessions }: { sessions: SessionSummary[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return createElement(
    "div",
    {
      ref: scrollRef,
      "data-scroll-owner": "",
      className: "overflow-y-auto",
    },
    createElement(GlobalSessionListWindow, {
      sessions,
      scrollRef: scrollRef as RefObject<HTMLDivElement | null>,
      isActive: (session) => session.cwd === "/workspace/two" && session.id === "session-250",
      renderSession: (session, active) =>
        createElement(
          "div",
          {
            "data-session-cwd": session.cwd,
            "data-session-id": session.id,
            "data-session-index": session.title.replace("Conversation ", ""),
            "data-global-active": active ? "true" : undefined,
          },
          session.title,
        ),
    }),
  );
}

let container: HTMLDivElement;
let root: Root;
let sessions: SessionSummary[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessions = makeSessions();
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-index") ? 64 : 480;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps global history bounded and scrollable while retaining exact active row", async () => {
  await act(async () => root.render(createElement(Window, { sessions })));
  const viewport = container.querySelector<HTMLElement>("[data-scroll-owner]")!;
  const list = container.querySelector<HTMLElement>("[data-session-list]")!;
  Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 100_000 });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 640, 320);
  list.getBoundingClientRect = () => new DOMRect(0, 0, 640, 64_000);

  const activeRows = () => container.querySelectorAll('[data-global-active="true"]');
  expect(activeRows()).toHaveLength(1);
  expect(activeRows()[0].getAttribute("data-session-cwd")).toBe("/workspace/two");
  expect(activeRows()[0].getAttribute("data-session-index")).toBe("750");
  expect(container.querySelectorAll("[data-index]").length).toBeLessThan(100);
  expect(list.parentElement).toBe(viewport);

  viewport.scrollTop = 25_000;
  await act(async () => viewport.dispatchEvent(new Event("scroll")));
  const indices = Array.from(container.querySelectorAll<HTMLElement>("[data-index]"), (row) =>
    Number(row.dataset.index),
  );
  expect(indices.some((index) => index > 300 && index < 500)).toBe(true);
  expect(indices).toContain(750);
  expect(activeRows()).toHaveLength(1);
  expect(container.querySelectorAll("[data-index]").length).toBeLessThan(100);
  expect(viewport.scrollTop).toBe(25_000);
});

it("keeps browser scroll anchoring off the windowed session scroller", () => {
  // The virtualizer already corrects the offset; a second browser correction jumps the list.
  const css = readFileSync("src/app/shell/sessionList.css", "utf8");
  expect(css).toMatch(/\.sidebar-session-scroll\s*\{[^}]*overflow-anchor:\s*none/);
});
