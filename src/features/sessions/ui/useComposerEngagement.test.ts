import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEngagement,
  ENGAGEMENT_LEAVE_DELAY_MS,
  ENGAGEMENT_RECHECK_MS,
  isOverlayElement,
} from "./useComposerEngagement";

let holds = false;
let windowFocused = true;
let changes: Array<[boolean, boolean]> = [];

function create() {
  return createEngagement(
    {
      holdsFocus: () => holds,
      windowFocused: () => windowFocused,
      timers: {
        set: (callback, delay) => setTimeout(callback, delay),
        clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
    },
    (engaged, sync) => changes.push([engaged, sync]),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  holds = false;
  windowFocused = true;
  changes = [];
});
afterEach(() => vi.useRealTimers());

describe("composer engagement", () => {
  it("engages at once for keyboard focus and leaves only after focus stays elsewhere", () => {
    const engagement = create();
    engagement.focusIn();
    expect(engagement.engaged).toBe(true);
    engagement.focusOut(false);
    expect(engagement.engaged).toBe(true);
    vi.advanceTimersByTime(ENGAGEMENT_LEAVE_DELAY_MS);
    expect(engagement.engaged).toBe(false);
  });

  it("does not leave when focus moves between composer controls or into its popup", () => {
    const engagement = create();
    engagement.focusIn();
    // Tab from the textarea to the model picker: still inside the composer.
    engagement.focusOut(true);
    vi.advanceTimersByTime(ENGAGEMENT_LEAVE_DELAY_MS * 2);
    expect(engagement.engaged).toBe(true);
    // The picker opens a portalled menu: focus leaves the dock and lands in it.
    engagement.focusOut(false);
    engagement.focusIn();
    vi.advanceTimersByTime(ENGAGEMENT_LEAVE_DELAY_MS * 2);
    expect(engagement.engaged).toBe(true);
    // A focus transfer that has not landed yet but ends inside an overlay holds.
    engagement.focusOut(false);
    holds = true;
    vi.advanceTimersByTime(ENGAGEMENT_LEAVE_DELAY_MS);
    expect(engagement.engaged).toBe(true);
    expect(changes).toEqual([[true, false]]);
  });

  it("keeps the layout while another window holds focus", () => {
    const engagement = create();
    engagement.focusIn();
    windowFocused = false;
    engagement.focusOut(false);
    vi.advanceTimersByTime(ENGAGEMENT_LEAVE_DELAY_MS * 3);
    expect(engagement.engaged).toBe(true);
  });

  it("leaves once focus parked in an outside overlay or window returns to the page", () => {
    const engagement = create();
    engagement.focusIn();
    // An approval toast takes focus, then unmounts without the composer seeing an event.
    holds = true;
    engagement.focusOut(false);
    vi.advanceTimersByTime(ENGAGEMENT_LEAVE_DELAY_MS + ENGAGEMENT_RECHECK_MS * 2);
    expect(engagement.engaged).toBe(true);
    holds = false;
    vi.advanceTimersByTime(ENGAGEMENT_RECHECK_MS);
    expect(engagement.engaged).toBe(false);
    // Same after another window gave focus back.
    engagement.focusIn();
    windowFocused = false;
    engagement.focusOut(false);
    vi.advanceTimersByTime(ENGAGEMENT_LEAVE_DELAY_MS + ENGAGEMENT_RECHECK_MS);
    expect(engagement.engaged).toBe(true);
    windowFocused = true;
    vi.advanceTimersByTime(ENGAGEMENT_RECHECK_MS);
    expect(engagement.engaged).toBe(false);
  });

  it("stays full while a drag is over the composer and leaves after it ends", () => {
    const engagement = create();
    engagement.dragEnter();
    expect(engagement.engaged).toBe(true);
    // Moving onto a child: the child's enter precedes the parent's leave.
    engagement.dragEnter();
    engagement.dragLeave();
    vi.advanceTimersByTime(ENGAGEMENT_LEAVE_DELAY_MS * 3);
    expect(engagement.engaged).toBe(true);
    engagement.drop();
    vi.advanceTimersByTime(ENGAGEMENT_LEAVE_DELAY_MS);
    expect(engagement.engaged).toBe(false);
  });

  it("applies pointer focus at the click, before the pressed control's handlers", () => {
    const engagement = create();
    engagement.pointerDown();
    engagement.focusIn();
    // Nothing moved between press and release.
    expect(engagement.engaged).toBe(false);
    engagement.pointerUp();
    engagement.click();
    expect(changes).toEqual([[true, true]]);
    vi.runAllTimers();
    expect(changes).toEqual([[true, true]]);
  });

  it("applies a press that never became a click after the release", () => {
    const engagement = create();
    engagement.pointerDown();
    engagement.focusIn();
    engagement.pointerUp();
    expect(engagement.engaged).toBe(false);
    vi.advanceTimersByTime(0);
    expect(engagement.engaged).toBe(true);
    expect(changes).toEqual([[true, false]]);
  });

  it("does not leave during a pointer press or IME composition, then resumes", () => {
    const engagement = create();
    engagement.focusIn();
    engagement.compositionStart();
    engagement.focusOut(false);
    vi.advanceTimersByTime(ENGAGEMENT_LEAVE_DELAY_MS * 2);
    expect(engagement.engaged).toBe(true);
    engagement.compositionEnd();
    vi.advanceTimersByTime(ENGAGEMENT_LEAVE_DELAY_MS);
    expect(engagement.engaged).toBe(false);

    engagement.focusIn();
    engagement.pointerDown();
    engagement.focusOut(false);
    vi.advanceTimersByTime(ENGAGEMENT_LEAVE_DELAY_MS * 2);
    expect(engagement.engaged).toBe(true);
    engagement.pointerUp();
    vi.advanceTimersByTime(ENGAGEMENT_LEAVE_DELAY_MS + 1);
    expect(engagement.engaged).toBe(false);
  });

  it("stops pending work on dispose", () => {
    const engagement = create();
    engagement.focusIn();
    engagement.focusOut(false);
    engagement.dispose();
    vi.advanceTimersByTime(ENGAGEMENT_LEAVE_DELAY_MS * 2);
    expect(engagement.engaged).toBe(true);
  });
});

describe("composer overlays", () => {
  it("recognises portalled menus, pickers and dialogs but not the transcript", () => {
    const menu = { closest: (selector: string) => (selector.includes("role='menu'") ? {} : null) };
    const none = { closest: () => null };
    expect(isOverlayElement(menu as unknown as Element)).toBe(true);
    expect(isOverlayElement(none as unknown as Element)).toBe(false);
    expect(isOverlayElement(null)).toBe(false);
  });
});
