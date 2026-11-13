// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VoiceCore } from "./VoiceCore";
import { VoiceCompanionStatus } from "./VoiceCompanionStatus";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const spokeLength = (line: Element) =>
  Math.hypot(
    Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")),
    Number(line.getAttribute("y2")) - Number(line.getAttribute("y1")),
  );

it("follows the measured input while you speak and stays flat when muted", () => {
  const level = { current: 0.9 };
  act(() =>
    root.render(
      createElement(VoiceCore, { state: "listening", level, name: "", avatar: undefined }),
    ),
  );
  const core = host.querySelector<HTMLElement>("[data-state]")!;
  expect(core.dataset.pose).toBe("user");
  const loud = Math.max(...[...host.querySelectorAll("[data-spoke]")].map(spokeLength));
  expect(loud).toBeGreaterThan(4);

  act(() =>
    root.render(createElement(VoiceCore, { state: "muted", level, name: "", avatar: undefined })),
  );
  const quiet = Math.max(...[...host.querySelectorAll("[data-spoke]")].map(spokeLength));
  expect(quiet).toBeCloseTo(1, 1);
});

it("draws a broken ring without turning arcs on error and shows the avatar initial", () => {
  act(() =>
    root.render(
      createElement(VoiceCore, {
        state: "error",
        level: { current: 0 },
        name: "Arif",
        avatar: undefined,
      }),
    ),
  );
  expect(host.querySelector("[data-turn]")).toBeNull();
  expect(host.querySelector("[data-initial]")?.getAttribute("data-initial")).toBe("A");
});

it("shows the engine always and the session clock only while live", () => {
  vi.useFakeTimers();
  const props = {
    visualState: "listening" as const,
    working: false,
    audioLevel: { current: 0.5 },
    statusText: "Listening",
    sessionStatusText: "",
    live: true,
    engine: "OpenAI",
    privacy: "Audio is sent to the provider while voice is on.",
    workspace: false,
    globalScope: true,
    name: "Arif",
    avatar: undefined,
    onScopeChange: () => {},
    onStopWork: () => {},
  };
  act(() => root.render(createElement(VoiceCompanionStatus, props)));
  expect(host.textContent).toContain("OpenAI");
  expect(host.querySelectorAll("i[data-on]").length).toBe(5);
  expect(host.textContent).toContain("0:00");
  act(() => vi.advanceTimersByTime(3_000));
  expect(host.textContent).toContain("0:03");

  act(() => root.render(createElement(VoiceCompanionStatus, { ...props, live: false })));
  expect(host.textContent).toContain("OpenAI");
  expect(host.textContent).not.toContain("0:03");
});
