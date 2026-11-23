// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewScene, crewActionAt, labelLift } from "./CrewScene";
import { CODE_HEIGHT, SIGN_HEIGHT, SIGN_TOP } from "./crewCodeArt";
import { EmptySession } from "./EmptySession";
import { TYPING_HOLD_MS } from "./crewTypingHold";
import { saveCrewGrowthEnabled, saveCrewSceneEnabled } from "../../settings/model/settings";
import type { Session } from "../model/session";

const state = vi.hoisted(() => ({
  enabled: true,
  windowVisible: true,
  paint: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../../settings/model/decorativeMotion", () => ({
  useDecorativeMotionEnabled: () => state.enabled,
  useMotionWindowVisible: () => state.windowVisible,
}));
vi.mock("./crewCodeArt", () => ({
  CODE_WIDTH: 1040,
  CODE_HEIGHT: 300,
  SIGN_TOP: 14,
  SIGN_HEIGHT: 58,
  CREW_TOP: 0,
  loadCrewSignLogo: () => Promise.resolve(),
  createCodeArtPainter: () => Object.assign(state.paint, { dispose: state.dispose }),
}));
let root: Root;
let container: HTMLDivElement;
let intersection: IntersectionObserverCallback;
const intersectionDisconnect = vi.fn();
const resizeDisconnect = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  state.enabled = true;
  state.windowVisible = true;
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersection = callback;
      }
      observe() {}
      unobserve() {}
      disconnect = intersectionDisconnect;
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect = resizeDisconnect;
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const render = () => act(() => root.render(createElement(CrewScene)));
const enter = () =>
  act(() =>
    intersection(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
it("renders exactly seven characters for seven working agents", () => {
  act(() => root.render(createElement(CrewScene, { workingCount: 7 })));
  enter();
  act(() => vi.advanceTimersByTime(1500));
  expect(state.paint.mock.calls.at(-1)?.[0]).toHaveLength(7);
  expect(state.paint.mock.calls.at(-1)?.[1]).toHaveLength(7);
});
it("welcomes twelve agents from the sides and removes departing guests", () => {
  render();
  enter();
  act(() => root.render(createElement(CrewScene, { workingCount: 12 })));
  act(() => vi.advanceTimersByTime(1200));
  expect(state.paint.mock.calls.at(-1)?.[0]).toHaveLength(12);
  expect(
    state.paint.mock.calls.at(-1)?.[1].every((person: { arrival: number }) => person.arrival === 1),
  ).toBe(true);
  act(() => root.render(createElement(CrewScene, { workingCount: 2 })));
  act(() => vi.advanceTimersByTime(300));
  expect(state.paint.mock.calls.at(-1)?.[0]).toHaveLength(12);
  act(() => vi.advanceTimersByTime(1000));
  expect(state.paint.mock.calls.at(-1)?.[0]).toHaveLength(6);
});
it("places all extra guests immediately with reduced motion", () => {
  state.enabled = false;
  act(() => root.render(createElement(CrewScene, { workingCount: 12 })));
  expect(
    state.paint.mock.calls.at(-1)?.[1].every((person: { arrival: number }) => person.arrival === 1),
  ).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it("stands exactly five speakers and sits them again when work ends", () => {
  render();
  enter();
  act(() => root.render(createElement(CrewScene, { workingCount: 5 })));
  act(() => vi.advanceTimersByTime(660));
  const active = state.paint.mock.calls.at(-1)?.[1];
  expect(active.filter((person: { stand: number }) => person.stand === 1)).toHaveLength(5);
  expect(active[5].stand).toBe(0);
  expect(active.map((person: { role: string }) => person.role).slice(2, 4)).toEqual([
    "lead",
    "advisor",
  ]);
  expect(active.some((person: { talk: number }) => person.talk > 0)).toBe(true);
  act(() => root.render(createElement(CrewScene, { workingCount: 0 })));
  act(() => vi.advanceTimersByTime(660));
  expect(
    state.paint.mock.calls.at(-1)?.[1].every((person: { stand: number }) => person.stand === 0),
  ).toBe(true);
});

it("exposes one descriptive group, with no interactive game controls", () => {
  container.innerHTML = renderToStaticMarkup(createElement(CrewScene));
  expect(container.querySelector('[role="group"]')?.getAttribute("aria-label")).toContain(
    "bycoda sign",
  );
  // The live canvas and its typing still are both decorative; neither is exposed.
  expect(container.querySelectorAll("canvas[aria-hidden=true]")).toHaveLength(2);
  expect(container.querySelectorAll("canvas:not([aria-hidden=true])")).toHaveLength(0);
  expect(container.querySelectorAll("button,input,[tabindex]")).toHaveLength(0);
  expect(container.firstElementChild?.getAttribute("data-motion")).toBe("still");
});
it("paints six tea holders while static and schedules no animation", () => {
  state.enabled = false;
  render();
  enter();
  expect(state.paint.mock.calls[0][0]).toHaveLength(6);
  expect(state.paint.mock.calls[0][0].every((pose: string) => pose === "idle")).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it("cancels animation callbacks when hidden and restarts only when visible", () => {
  render();
  enter();
  expect(vi.getTimerCount()).toBe(1);
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(vi.getTimerCount()).toBe(0);
  const count = state.paint.mock.calls.length;
  act(() => vi.advanceTimersByTime(30000));
  expect(state.paint).toHaveBeenCalledTimes(count);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(vi.getTimerCount()).toBe(1);
  act(() =>
    intersection(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  expect(vi.getTimerCount()).toBe(0);
});
it("holds the scene while the window is hidden or minimized", () => {
  render();
  enter();
  expect(vi.getTimerCount()).toBe(1);
  state.windowVisible = false;
  render();
  expect(vi.getTimerCount()).toBe(0);
  const count = state.paint.mock.calls.length;
  act(() => vi.advanceTimersByTime(30000));
  expect(state.paint).toHaveBeenCalledTimes(count);
  state.windowVisible = true;
  render();
  // The re-armed observers report the viewport again before the loop resumes.
  enter();
  expect(vi.getTimerCount()).toBe(1);
});
/** One real edit: `beforeinput` then `input`, as engines fire them. */
const edit = (target: HTMLElement, type = "insertText") =>
  act(() => {
    target.dispatchEvent(new InputEvent("beforeinput", { inputType: type, bubbles: true }));
    target.dispatchEvent(new InputEvent("input", { inputType: type, bubbles: true }));
  });
const field = () => {
  const element = document.createElement("textarea");
  document.body.append(element);
  return element;
};
const still = () => container.querySelector<HTMLCanvasElement>(".crew-scene__still");
it("holds its last frame while typing in a field and resumes after the burst, without rebuilding the painter", () => {
  const input = field();
  render();
  enter();
  act(() => vi.advanceTimersByTime(600));
  expect(vi.getTimerCount()).toBe(1);
  // A lone edit only opens the window: the scene keeps animating.
  edit(input);
  act(() => vi.advanceTimersByTime(300));
  expect(container.querySelector(".crew-scene")?.hasAttribute("data-still")).toBe(false);
  const painted = state.paint.mock.calls.length;
  act(() => vi.advanceTimersByTime(300));
  expect(state.paint.mock.calls.length).toBeGreaterThan(painted);
  for (let key = 0; key < 20; key++) {
    edit(input);
    act(() => vi.advanceTimersByTime(40));
  }
  const held = state.paint.mock.calls.length;
  act(() => vi.advanceTimersByTime(300));
  edit(input);
  act(() => vi.advanceTimersByTime(300));
  expect(state.paint.mock.calls.length).toBe(held);
  expect(state.dispose).not.toHaveBeenCalled();
  expect(container.querySelector(".crew-scene")?.getAttribute("data-motion")).toBe("running");
  expect(container.querySelector(".crew-scene")?.hasAttribute("data-still")).toBe(true);
  act(() => vi.advanceTimersByTime(TYPING_HOLD_MS));
  expect(container.querySelector(".crew-scene")?.hasAttribute("data-still")).toBe(false);
  act(() => vi.advanceTimersByTime(600));
  expect(state.paint.mock.calls.length).toBeGreaterThan(held);
  expect(state.dispose).not.toHaveBeenCalled();
  input.remove();
});
it("retains the frame as a still with the rim baked in while held, and drops it on resume", () => {
  const input = field();
  render();
  enter();
  act(() => vi.advanceTimersByTime(600));
  const context = still()!.getContext("2d") as unknown as { drawImage: ReturnType<typeof vi.fn> };
  context.drawImage.mockClear();
  edit(input);
  expect(context.drawImage).not.toHaveBeenCalled();
  edit(input);
  expect(context.drawImage).toHaveBeenCalledTimes(1);
  expect(context.drawImage.mock.calls[0][0]).toBe(container.querySelector("canvas"));
  // Further keys neither redraw the still nor rebuild anything.
  edit(input);
  edit(input);
  expect(context.drawImage).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(TYPING_HOLD_MS));
  expect(container.querySelector(".crew-scene")?.hasAttribute("data-still")).toBe(false);
  input.remove();
});
it("holds for pastes, dictation and `input`-only engines but not for command chords or caret keys", () => {
  const input = field();
  render();
  enter();
  const held = () => container.querySelector(".crew-scene")?.hasAttribute("data-still");
  for (const type of ["insertFromPaste", "insertFromPaste"]) edit(input, type);
  expect(held()).toBe(true);
  act(() => vi.advanceTimersByTime(TYPING_HOLD_MS));
  expect(held()).toBe(false);
  // No beforeinput: the `input` fallback counts each event.
  act(() => void input.dispatchEvent(new InputEvent("input", { bubbles: true })));
  act(() => void input.dispatchEvent(new InputEvent("input", { bubbles: true })));
  expect(held()).toBe(true);
  act(() => vi.advanceTimersByTime(TYPING_HOLD_MS));
  expect(held()).toBe(false);
  // Ctrl+C, selection and caret keys fire keydown only; none of them edits.
  for (const init of [
    { key: "c", ctrlKey: true },
    { key: "a", ctrlKey: true },
    { key: "ArrowLeft" },
  ])
    act(() => void input.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true })));
  act(() => void input.dispatchEvent(new Event("copy", { bubbles: true })));
  expect(held()).toBe(false);
  act(() => vi.advanceTimersByTime(600));
  expect(vi.getTimerCount()).toBe(1);
  input.remove();
});
it("ignores edits outside editable fields and checkboxes", () => {
  render();
  enter();
  const box = document.createElement("input");
  box.type = "checkbox";
  document.body.append(box);
  for (const target of [document.body, box]) {
    edit(target);
    edit(target);
  }
  expect(container.querySelector(".crew-scene")?.hasAttribute("data-still")).toBe(false);
  expect(vi.getTimerCount()).toBe(1);
  box.remove();
});
it("releases the typing listeners and timer when the scene unmounts mid-burst", () => {
  const input = field();
  render();
  enter();
  edit(input);
  edit(input);
  act(() => root.render(createElement("div")));
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(TYPING_HOLD_MS));
  expect(state.paint).toHaveBeenCalled();
  input.remove();
});
it("does not hold a scene that visibility or reduced motion already stopped", () => {
  const input = field();
  state.enabled = false;
  render();
  enter();
  const count = state.paint.mock.calls.length;
  edit(input);
  edit(input);
  act(() => vi.advanceTimersByTime(TYPING_HOLD_MS));
  expect(state.paint.mock.calls.length).toBeLessThanOrEqual(count + 1);
  expect(vi.getTimerCount()).toBe(0);
  input.remove();
});
it("visibly starts a tea sip soon after entering the viewport and continues after visibility changes", () => {
  render();
  enter();
  act(() => vi.advanceTimersByTime(1560));
  expect(state.paint.mock.calls.at(-1)?.[0][0]).toBe("sip-low");
  act(() => vi.advanceTimersByTime(540));
  expect(state.paint.mock.calls.at(-1)?.[0][0]).toBe("sip");
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  act(() => vi.advanceTimersByTime(5000));
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  act(() => vi.advanceTimersByTime(5580));
  expect(state.paint.mock.calls.at(-1)?.[0][2]).not.toBe("idle");
});
it("labels roles, hides them for the background aria tree, and keeps sessions apart", () => {
  act(() => root.render(createElement(CrewScene, { workingCount: 2 })));
  const labels = [...container.querySelectorAll(".crew-scene__label")];
  expect(labels).toHaveLength(6);
  expect(
    labels.map((label) => label.textContent).filter((text) => text === "Main agent"),
  ).toHaveLength(1);
  expect(
    labels
      .filter((label) => label.getAttribute("data-working") === "true")
      .map((label) => label.getAttribute("data-role"))
      .sort(),
  ).toEqual(["advisor", "lead"]);
  expect(container.querySelector(".crew-scene__labels")?.hasAttribute("aria-hidden")).toBe(false);
  expect(container.querySelector(".crew-scene")?.getAttribute("role")).toBe("group");
  expect(labels.every((label) => label.hasAttribute("data-tooltip-owner"))).toBe(true);
  // Idle sessions seat everyone regardless of other sessions' work.
  act(() => root.render(createElement(CrewScene, { sessionId: "quiet" })));
  expect(container.querySelectorAll('[data-working="true"]')).toHaveLength(0);
});
it("updates assigned names immediately while motion is disabled", () => {
  state.enabled = false;
  const crew = [
    { role: "subagent" as const, working: false, context: 0.7, name: "Designer" },
    ...Array.from({ length: 5 }, () => ({ role: "subagent" as const, working: false, context: 0 })),
  ];
  act(() => root.render(createElement(CrewScene, { crew })));
  const label = container.querySelector(".crew-scene__label") as HTMLSpanElement;
  expect(label.textContent).toBe("Designer");
  expect(parseFloat(label.style.insetBlockStart)).toBeLessThan((312 / 300) * 100);
  act(() =>
    root.render(
      createElement(CrewScene, { crew: [{ ...crew[0], name: "UX Designer" }, ...crew.slice(1)] }),
    ),
  );
  expect(label.textContent).toBe("UX Designer");
  expect(label.hasAttribute("title")).toBe(false);
  expect(label.hasAttribute("data-tooltip-owner")).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it("changes an empty crew to babies after the first message and honors the growth switch", () => {
  state.enabled = false;
  // Sessions are immutable: each update is a new object, as the store produces.
  let session = { id: "crew-test", blocks: [] } as unknown as Session;
  const renderSession = () =>
    act(() => root.render(createElement(CrewScene, { sessionId: session.id, session })));
  renderSession();
  const stages = () =>
    state.paint.mock.calls.at(-1)?.[1].map((seat: { age: { stage: number } }) => seat.age.stage);
  expect(stages()).toEqual([3, 3, 3, 3, 3, 3]);
  session = { ...session, blocks: [{ id: "first", role: "user", text: "Start" }] };
  renderSession();
  expect(stages()).toEqual([0, 0, 0, 0, 0, 0]);
  session = { ...session, context: { used: 180_000, window: 200_000 } };
  renderSession();
  expect(stages()).toEqual([0, 0, 3, 0, 0, 0]);
  act(() => saveCrewGrowthEnabled(false));
  expect(stages()).toEqual([3, 3, 3, 3, 3, 3]);
});
it("cleans observers and timer on unmount", () => {
  render();
  enter();
  act(() => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
  expect(intersectionDisconnect).toHaveBeenCalledOnce();
  // The scene's own observer and the window-wide one that follows the clipped labels.
  expect(resizeDisconnect).toHaveBeenCalledTimes(2);
  expect(state.dispose).toHaveBeenCalled();
});

it("releases a still painter when decorative motion is disabled", () => {
  state.enabled = false;
  render();
  state.dispose.mockClear();
  act(() => root.render(null));
  expect(state.dispose).toHaveBeenCalledOnce();
});
it("keeps decorative backgrounds out of the accessibility tree", () => {
  container.innerHTML = renderToStaticMarkup(createElement(CrewScene, { variant: "background" }));
  expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  expect(container.querySelector('[role="img"]')).toBeNull();
});
it("keeps backdrop labels inert, hidden and free of tooltips", () => {
  state.enabled = false;
  act(() => root.render(createElement(CrewScene, { variant: "background", workingCount: 2 })));
  const labels = [...container.querySelectorAll(".crew-scene__label")];
  expect(labels).toHaveLength(6);
  expect(container.querySelector(".crew-scene__labels")?.getAttribute("aria-hidden")).toBe("true");
  expect(labels.every((label) => !label.hasAttribute("data-tooltip-owner"))).toBe(true);
  expect(labels.every((label) => !label.hasAttribute("tabindex"))).toBe(true);
  expect(labels.every((label) => !label.hasAttribute("data-clipped"))).toBe(true);
});
it("leaves fully visible hero labels out of the tab order and out of hit testing", () => {
  state.enabled = false;
  act(() => root.render(createElement(CrewScene, { workingCount: 2 })));
  const labels = [...container.querySelectorAll(".crew-scene__label")];
  expect(labels).toHaveLength(6);
  expect(labels.every((label) => !label.hasAttribute("tabindex"))).toBe(true);
  expect(labels.every((label) => !label.hasAttribute("data-clipped"))).toBe(true);
});
it("staggers quiet tea sips across all six men without simultaneous motion", () => {
  for (let id = 0; id < 6; id++) {
    expect(crewActionAt(id, 0)).toBe("idle");
    const start = 1500 + id * 5500;
    expect(crewActionAt(id, start)).toBe("sip-low");
    expect(crewActionAt(id, start + 540)).toBe("sip");
    expect(crewActionAt(id, start + 2300)).toBe("sip-lift");
    expect(crewActionAt(id, start + 2700)).toBe("idle");
    expect(crewActionAt(id, start + 36000)).toBe("sip-low");
  }
  for (let time = 0; time < 100000; time += 200) {
    const moving = Array.from({ length: 6 }, (_, id) => crewActionAt(id, time)).filter(
      (pose) => pose !== "idle",
    );
    expect(moving.length).toBeLessThanOrEqual(1);
  }
});
it("switches off artwork without removing the task draft", async () => {
  await act(async () =>
    root.render(
      createElement(EmptySession, {
        cwd: "",
        composer: createElement("textarea", { defaultValue: "my draft" }),
      }),
    ),
  );
  const draft = container.querySelector("textarea");
  expect(container.querySelector("canvas")).not.toBeNull();
  act(() => saveCrewSceneEnabled(false));
  expect(container.querySelector("canvas")).toBeNull();
  expect(container.querySelector("textarea")).toBe(draft);
  expect(draft?.value).toBe("my draft");
});

it("keeps classic crew labels below the hanging sign at every scene size", () => {
  const signBottom = SIGN_TOP + SIGN_HEIGHT;
  // A label anchored just under the sign may rise only to the sign's lower edge (plus the gap).
  const lift = labelLift(signBottom + 10, true);
  expect(lift).toBe(`max(-100%, ${(((-10 + 4) / CODE_HEIGHT) * 100).toFixed(3)}cqh)`);
  // Rigged themes draw no sign, so their labels keep their natural lift.
  expect(labelLift(signBottom + 10, false)).toBe("-100%");
});

it("classic color mode keeps uncles and agrees with context meters", () => {
  state.enabled = false;
  act(() => saveCrewGrowthEnabled(false));
  const make = (context?: number) =>
    Array.from({ length: 6 }, () => ({ role: "subagent" as const, working: false, context }));
  act(() => root.render(createElement(CrewScene, { crew: make(0.5) })));
  const labels = () => [...container.querySelectorAll(".crew-scene__label")];
  expect(labels().every((label) => label.getAttribute("data-age") === "3")).toBe(true);
  expect(labels().every((label) => label.getAttribute("data-charge") === "50")).toBe(true);
  expect(labels()[0].textContent).toContain("50%");
  expect(labels()[0].querySelector(".crew-scene__name")?.textContent).not.toContain("50%");
  expect(labels()[0].querySelector(".crew-scene__charge")?.textContent).toBe("50%");
  expect(container.querySelector(".crew-scene")?.getAttribute("aria-label")).not.toContain(
    "Monochrome",
  );
  act(() => root.render(createElement(CrewScene, { crew: make() })));
  expect(labels()[0].getAttribute("data-charge")).toBe("unknown");
  expect(labels()[0].querySelector(".crew-scene__charge")?.textContent).toBe("—");
  act(() => saveCrewGrowthEnabled(true));
  expect(labels()[0].hasAttribute("data-charge")).toBe(false);
  expect(labels()[0].querySelector(".crew-scene__charge, .crew-scene__meter")).toBeNull();
});
