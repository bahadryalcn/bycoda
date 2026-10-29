import { t } from "../i18n/technical";

export const EXPLORER_FILE_POINTER_DRAG_EVENT = "bycoda:explorer-file-pointer-drag";

export type ExplorerFilePointerDragDetail =
  | { type: "move" | "drop"; path: string; paths?: string[]; x: number; y: number }
  | { type: "end"; path: string };

export function emitExplorerFilePointerDrag(detail: ExplorerFilePointerDragDetail) {
  window.dispatchEvent(
    new CustomEvent<ExplorerFilePointerDragDetail>(EXPLORER_FILE_POINTER_DRAG_EVENT, { detail }),
  );
}

/**
 * Where a dragged item will land, as one vocabulary for every surface. The stylesheet draws each
 * value from theme tokens (`[data-drop-indicator]` in index.css), so a row, a tab and a pane edge
 * look the same and the user can tell "between", "into" and "split" apart before releasing.
 */
export type DropPlacement =
  | "before"
  | "after"
  | "inside"
  | "group"
  | "split-start"
  | "split-end"
  | "split-top"
  | "split-bottom"
  | "blocked";

let dropHint: HTMLDivElement | null = null;
let dropHintKey = "";
let indicatorElement: HTMLElement | null = null;
let announcer: HTMLElement | null = null;
let grabbing = false;

/**
 * The owner of a drag ends it on Escape, pointer cancel or window blur and clears the badge.
 * This is the backstop: should an owner unmount or miss one of those, the badge and the target
 * indicator still never outlive the gesture.
 */
function dismissStrandedFeedback(event: Event) {
  if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape") return;
  clearDropFeedback();
}
const STRAND_EVENTS = ["keydown", "pointercancel", "blur"] as const;
let backstopsArmed = false;

function armBackstops() {
  if (backstopsArmed) return;
  backstopsArmed = true;
  for (const type of STRAND_EVENTS) window.addEventListener(type, dismissStrandedFeedback);
}

function releaseBackstopsWhenIdle() {
  if (!backstopsArmed || dropHint || indicatorElement) return;
  backstopsArmed = false;
  for (const type of STRAND_EVENTS) window.removeEventListener(type, dismissStrandedFeedback);
}

function setDragCursor(cursor: string) {
  document.body.style.cursor = cursor;
  document.body.style.setProperty("--workspace-drag-cursor", cursor || "auto");
}

/**
 * Shared pointer feedback; the badge never intercepts hit testing. It is the only cursor badge:
 * `subject` names what is moving (kept short), `label` says what releasing will do. Targets draw
 * their own landing mark with {@link setDropIndicator} and never repeat the instruction.
 */
export function setDropFeedback(
  action: "move" | "window" | "blocked",
  pointer: { clientX: number; clientY: number },
  label?: string,
  subject?: string,
) {
  setDragCursor(action === "blocked" ? "not-allowed" : action === "window" ? "alias" : "move");
  if (!dropHint) {
    dropHint = document.createElement("div");
    dropHint.className = "pointer-drop-hint";
    dropHint.setAttribute("aria-hidden", "true");
    document.body.append(dropHint);
    armBackstops();
  }
  dropHint.dataset.action = action;
  const text =
    label ??
    (action === "blocked"
      ? t("Cannot drop here")
      : action === "window"
        ? t("Move to another window")
        : t("Release to move"));
  // Rewriting identical text on every pointer move would restart text layout and flicker.
  const key = `${subject ?? ""}|${text}`;
  if (key !== dropHintKey) {
    dropHintKey = key;
    if (subject) {
      const name = document.createElement("span");
      name.className = "pointer-drop-hint-subject";
      name.textContent = subject;
      dropHint.replaceChildren(name, text);
    } else dropHint.textContent = text;
  }
  dropHint.style.left = `${Math.max(8, Math.min(pointer.clientX + 18, window.innerWidth - dropHint.offsetWidth - 8))}px`;
  dropHint.style.top = `${Math.max(8, Math.min(pointer.clientY + 22, window.innerHeight - dropHint.offsetHeight - 8))}px`;
}

function clearIndicatorAttributes(element: HTMLElement) {
  delete element.dataset.dropIndicator;
  delete element.dataset.dropAxis;
}

/**
 * Marks the one element that would receive the drop. Only one element carries the mark at a time,
 * so a stale target can never stay lit while another is chosen; Escape, pointer cancel and window
 * blur clear it through the same backstop as the badge.
 */
export function setDropIndicator(
  element: HTMLElement | null,
  placement: DropPlacement | null,
  axis: "x" | "y" = "y",
) {
  if (!element || !placement) {
    clearDropIndicator();
    return;
  }
  if (indicatorElement && indicatorElement !== element) clearIndicatorAttributes(indicatorElement);
  indicatorElement = element;
  if (element.dataset.dropIndicator !== placement) element.dataset.dropIndicator = placement;
  if (axis === "x") element.dataset.dropAxis = "x";
  else delete element.dataset.dropAxis;
  armBackstops();
}

export function clearDropIndicator() {
  if (indicatorElement) clearIndicatorAttributes(indicatorElement);
  indicatorElement = null;
  releaseBackstopsWhenIdle();
}

export function clearDropFeedback() {
  dropHint?.remove();
  dropHint = null;
  dropHintKey = "";
  clearDropIndicator();
  if (grabbing) setDragCursor("grabbing");
  else {
    document.body.style.cursor = "";
    document.body.style.removeProperty("--workspace-drag-cursor");
  }
}

function ensureAnnouncer() {
  if (announcer?.isConnected) return announcer;
  announcer = document.createElement("div");
  announcer.dataset.dragAnnouncer = "";
  announcer.setAttribute("role", "status");
  announcer.setAttribute("aria-live", "polite");
  announcer.setAttribute("aria-atomic", "true");
  // Visually hidden but still in the accessibility tree.
  Object.assign(announcer.style, {
    position: "absolute",
    width: "1px",
    height: "1px",
    margin: "-1px",
    padding: "0",
    border: "0",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  });
  document.body.append(announcer);
  return announcer;
}

/**
 * One polite live region for every drag. Callers announce a pick-up, a change of target and the
 * outcome (never pointer movement), so the stream stays short.
 */
export function announceDrag(message: string) {
  if (typeof document === "undefined" || !message) return;
  const region = ensureAnnouncer();
  // The same sentence twice in a row must still be spoken.
  region.textContent = region.textContent === message ? `${message}​` : message;
}

export function setGrabbing(on: boolean) {
  grabbing = on;
  // The live region must exist before its first message for screen readers to speak it.
  if (on) ensureAnnouncer();
  setDragCursor(on ? "grabbing" : "");
  if (on) document.documentElement.classList.add("is-grabbing");
  else document.documentElement.classList.remove("is-grabbing");
  if (!on) {
    clearDropFeedback();
    document.body.style.removeProperty("--workspace-drag-cursor");
  }
}

/** Block native text selection for the duration of a reorder gesture. */
export function suppressTextSelection() {
  const onSelectStart = (event: Event) => {
    event.preventDefault();
  };
  window.addEventListener("selectstart", onSelectStart);
  document.documentElement.classList.add("is-reordering");
  window.getSelection()?.removeAllRanges();
  return () => {
    window.removeEventListener("selectstart", onSelectStart);
    document.documentElement.classList.remove("is-reordering");
    window.getSelection()?.removeAllRanges();
  };
}
