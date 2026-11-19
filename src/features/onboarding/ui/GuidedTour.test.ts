// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EventData, Step } from "react-joyride";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import GuidedTour from "./GuidedTour";
import { runGuideAction } from "../model/guide";
import type { TourStepDef } from "../model/tourSteps";
import { ensureTourTarget } from "./tourRunner";

vi.mock("../model/guide", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/guide")>()),
  runGuideAction: vi.fn(),
}));

vi.mock("./tourRunner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tourRunner")>()),
  ensureTourTarget: vi.fn(async () => "centered" as const),
}));

// Joyride is replaced by a stub that shows the current card and two controls that send the
// events the tour reacts to (Next and Skip), so the test drives the real GuidedTour logic.
vi.mock("react-joyride", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-joyride")>();
  return {
    ...actual,
    Joyride: ({
      steps,
      stepIndex,
      onEvent,
    }: {
      steps: Step[];
      stepIndex: number;
      onEvent: (event: EventData) => void;
    }) =>
      createElement(
        "div",
        null,
        steps[stepIndex]?.content,
        createElement(
          "button",
          {
            type: "button",
            className: "test-next",
            onClick: () =>
              onEvent({ type: actual.EVENTS.STEP_AFTER, action: actual.ACTIONS.NEXT } as EventData),
          },
          "next",
        ),
        createElement(
          "button",
          {
            type: "button",
            className: "test-skip",
            onClick: () =>
              onEvent({
                type: actual.EVENTS.STEP_AFTER,
                action: actual.ACTIONS.CLOSE,
              } as EventData),
          },
          "skip",
        ),
      ),
  };
});

const steps: TourStepDef[] = [
  {
    id: "first",
    title: "First",
    body: "First card",
    targets: [],
    tryIt: { label: "Try first", action: "new-session" },
  },
  { id: "second", title: "Second", body: "Second card", targets: [] },
  { id: "third", title: "Third", body: "Third card", targets: [] },
];

const SETTLE_MS = 350;

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(runGuideAction).mockClear();
  vi.mocked(ensureTourTarget).mockClear();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container.remove();
  vi.useRealTimers();
});

async function renderTour(onEnd = vi.fn()) {
  await act(async () => {
    root?.render(createElement(GuidedTour, { steps, projectCwd: "C:/project", onEnd }));
  });
  return onEnd;
}

async function clickSelector(selector: string) {
  const element = container.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  await act(async () => element.click());
}

function lookups() {
  return vi.mocked(ensureTourTarget).mock.calls.length;
}

it("walks on after a Try it action settles while the tour is open", async () => {
  await renderTour();
  await clickSelector(".usage-guide-tryit");
  expect(runGuideAction).toHaveBeenCalledWith("new-session");

  const before = lookups();
  await act(async () => {
    vi.advanceTimersByTime(SETTLE_MS);
  });
  expect(lookups()).toBe(before + 1);
  expect(container.textContent).toContain("Second card");
});

it("cancels the pending Try it walk when the tour unmounts", async () => {
  await renderTour();
  await clickSelector(".usage-guide-tryit");
  expect(runGuideAction).toHaveBeenCalledTimes(1);

  const before = lookups();
  act(() => root?.unmount());
  root = null;
  await act(async () => {
    vi.advanceTimersByTime(SETTLE_MS * 4);
  });
  expect(lookups()).toBe(before);
});

it("cancels the pending Try it walk when the tour closes", async () => {
  const onEnd = await renderTour();
  await clickSelector(".usage-guide-tryit");

  await clickSelector(".test-skip");
  expect(onEnd).toHaveBeenCalledWith({ type: "skipped" });

  const before = lookups();
  await act(async () => {
    vi.advanceTimersByTime(SETTLE_MS * 4);
  });
  expect(lookups()).toBe(before);
});

it("cancels the pending Try it walk when the user moves to another card", async () => {
  await renderTour();
  await clickSelector(".usage-guide-tryit");

  // Next moves to "second" before the settle timer fires; the stale walk must not run.
  await clickSelector(".test-next");
  expect(container.textContent).toContain("Second card");

  const before = lookups();
  await act(async () => {
    vi.advanceTimersByTime(SETTLE_MS * 4);
  });
  expect(lookups()).toBe(before);
  expect(container.textContent).toContain("Second card");
});
