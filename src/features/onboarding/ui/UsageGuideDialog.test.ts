// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ACTIONS, EVENTS, STATUS, type Controls, type EventData, type Props } from "react-joyride";
import UsageGuideDialog from "./UsageGuideDialog";
import { saveKeybindingOverride } from "../../settings/model/settings";
import { setLanguagePreference } from "../../../shared/i18n";
import { hasActiveOverlay } from "../../../shared/ui/overlay";

let joyride: Props;
vi.mock("react-joyride", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-joyride")>();
  return {
    ...actual,
    Joyride: (props: Props) => {
      joyride = props;
      const current = props.steps[props.stepIndex ?? 0];
      return createElement("div", null, current.title, current.content);
    },
  };
});
let root: Root;
let container: HTMLDivElement;
const onClose = vi.fn();
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  onClose.mockClear();
  await setLanguagePreference("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(UsageGuideDialog, { onClose })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function event(data: Partial<EventData>) {
  await act(async () =>
    joyride.onEvent?.(
      {
        index: joyride.stepIndex ?? 0,
        status: STATUS.RUNNING,
        action: ACTIONS.NEXT,
        type: EVENTS.STEP_AFTER,
        ...data,
      } as EventData,
      {} as Controls,
    ),
  );
}
it("spotlights the active composer when workspace and guide mount in the same commit", async () => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    { width: 200, height: 40 },
  ] as unknown as DOMRectList);
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement("div", { "data-usage-guide": "composer" }),
        createElement("div", {
          "data-usage-guide": "composer",
          "data-usage-guide-active": "true",
        }),
        createElement(UsageGuideDialog, { onClose }),
      ),
    ),
  );
  const composer = container.querySelector('[data-usage-guide-active="true"]');
  expect(joyride.steps[0].target).toBe(composer);
  expect(joyride.steps[0].placement).toBe("auto");
});
it("teaches queue and stop even without a project and finishes without session actions", async () => {
  expect(container.textContent).toContain("Shift+Enter adds a new line");
  expect(joyride.steps[0].target).toBe(document.body);
  expect(joyride.steps[0].placement).toBe("center");
  expect(joyride.options?.blockTargetInteraction).toBe(true);
  expect(joyride.options?.closeButtonAction).toBe("skip");
  expect(joyride.options?.overlayClickAction).toBe(false);
  await event({});
  expect(container.textContent).toContain("Queued messages run in order");
  await event({});
  expect(container.textContent).toContain("Interrupting pauses the queue");
  expect(container.textContent).toContain("Stopping does not undo file changes");
  await event({ action: ACTIONS.PREV });
  expect(container.textContent).toContain("Queued messages run in order");
  await event({ index: 3 });
  expect(container.textContent).toContain("current shortcuts");
  await event({ status: STATUS.FINISHED, type: EVENTS.TOUR_END });
  expect(onClose).toHaveBeenCalledOnce();
});
it("updates custom and disabled shortcuts while open", async () => {
  await event({});
  await act(async () =>
    saveKeybindingOverride("Composer: Queue Message", {
      shortcut: "Control+Shift+KeyY",
    }),
  );
  expect(container.querySelector("kbd")?.textContent).toContain("Y");
  await act(async () => saveKeybindingOverride("Composer: Queue Message", { disabled: true }));
  expect(container.querySelector("kbd")).toBeNull();
  expect(container.querySelector("dd")?.textContent).toBe("Disabled");
});
it("closes when Done emits the final controlled step event before tour end", async () => {
  await event({ index: 3 });
  expect(joyride.stepIndex).toBe(4);
  await event({ action: ACTIONS.NEXT, type: EVENTS.STEP_AFTER });
  expect(onClose).toHaveBeenCalledOnce();
  await event({ status: STATUS.FINISHED, type: EVENTS.TOUR_END });
  expect(onClose).toHaveBeenCalledOnce();
});
it("renders Turkish copy and closes on skip once", async () => {
  await act(async () => setLanguagePreference("tr"));
  expect(container.textContent).toContain("Chat başlat");
  await event({});
  expect(container.textContent).toContain("Kuyruktaki mesajlar");
  expect(joyride.locale?.skip).toBe("Rehberi kapat");
  await event({
    status: STATUS.SKIPPED,
    action: ACTIONS.SKIP,
    type: EVENTS.TOUR_END,
  });
  await event({
    status: STATUS.SKIPPED,
    action: ACTIONS.SKIP,
    type: EVENTS.TOUR_END,
  });
  expect(onClose).toHaveBeenCalledOnce();
});
it("registers the overlay and consumes Escape before session listeners", async () => {
  expect(hasActiveOverlay()).toBe(true);
  const underlying = vi.fn();
  window.addEventListener("keydown", underlying);
  const key = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  await act(async () => window.dispatchEvent(key));
  expect(key.defaultPrevented).toBe(true);
  expect(underlying).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledOnce();
  window.removeEventListener("keydown", underlying);
  await act(async () => root.unmount());
  expect(hasActiveOverlay()).toBe(false);
  root = createRoot(container);
});
