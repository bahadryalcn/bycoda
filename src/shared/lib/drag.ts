import { t } from "../i18n/technical";
import { reorderMotion } from "./motion";

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
  else document.body.style.cursor = "";
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
  }
}

/**
 * Block new text selections without touching any style: enough for a gesture whose
 * pointerdown is already cancelled (a `Sash` drag), and free of a document-wide restyle.
 */
export function blockTextSelection() {
  const onSelectStart = (event: Event) => {
    event.preventDefault();
  };
  window.addEventListener("selectstart", onSelectStart);
  window.getSelection()?.removeAllRanges();
  return () => {
    window.removeEventListener("selectstart", onSelectStart);
    window.getSelection()?.removeAllRanges();
  };
}

/** Block native text selection for the duration of a reorder gesture. */
export function suppressTextSelection() {
  const restore = blockTextSelection();
  document.documentElement.classList.add("is-reordering");
  return () => {
    document.documentElement.classList.remove("is-reordering");
    restore();
  };
}

function motionDuration() {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return { ms: 0, easing: "" };
  const { duration, easing } = reorderMotion();
  return { ms: duration, easing };
}

/**
 * A lifted copy of the item being dragged. The real item stays in its list (the caller collapses or
 * hides it) while this copy follows the pointer, so the card itself seems to be carried. It never
 * intercepts hit testing, carries the only on-target hint (a short label on its lower edge) and
 * settles into the landing slot when the gesture ends. Opt-in: surfaces that do not create one keep
 * their own feedback.
 */
export type DragPreview = {
  /** Follow the pointer; `state` sets the cursor and the short label shown on the copy. */
  move(
    pointer: { clientX: number; clientY: number },
    state?: { action?: "move" | "window" | "blocked"; label?: string; bounds?: DOMRect },
  ): void;
  /** Glide to `rect` (viewport coordinates) and remove the copy; no rect removes it at once. */
  settleTo(rect: DOMRect | null, onDone?: () => void): void;
  dispose(): void;
};

let activePreview: DragPreview | null = null;

/** The copy must not duplicate ids, tooltips, focus stops or the markers the list queries for. */
function sanitizePreview(root: HTMLElement) {
  const strip = [
    "id",
    "title",
    "tabindex",
    "data-session-card",
    "data-drop-indicator",
    "data-drop-axis",
    "aria-describedby",
    "aria-labelledby",
  ];
  for (const element of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
    for (const name of strip) element.removeAttribute(name);
  }
  root.setAttribute("aria-hidden", "true");
  root.inert = true;
}

export function createDragPreview(
  source: HTMLElement,
  pointer: { clientX: number; clientY: number },
): DragPreview {
  activePreview?.dispose();
  const rect = source.getBoundingClientRect();
  const element = source.cloneNode(true) as HTMLElement;
  sanitizePreview(element);
  element.classList.add("pointer-drag-preview");
  element.dataset.dragPreview = "";
  Object.assign(element.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    opacity: "1",
    transformOrigin: `${pointer.clientX - rect.left}px ${pointer.clientY - rect.top}px`,
    transform: "translate3d(0, 0, 0)",
  });
  document.body.append(element);
  // Commit the resting style first so the lift animates instead of starting lifted.
  void element.getBoundingClientRect();
  element.dataset.lifted = "true";

  let label: HTMLElement | null = null;
  let labelText = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;

  const preview: DragPreview = {
    move(point, state) {
      if (done) return;
      const action = state?.action ?? "move";
      element.dataset.action = action;
      setDragCursor(action === "blocked" ? "not-allowed" : action === "window" ? "alias" : "move");
      const text =
        state?.label ??
        (action === "blocked"
          ? t("Cannot drop here")
          : action === "window"
            ? t("Move to another window")
            : "");
      if (text !== labelText) {
        labelText = text;
        if (!text) {
          label?.remove();
          label = null;
        } else {
          if (!label) {
            label = document.createElement("span");
            label.className = "pointer-drag-preview-label";
            element.append(label);
          }
          label.textContent = text;
        }
      }
      const bounds = state?.bounds;
      if (label) label.style.translate = bounds ? "0" : "";
      const width = bounds ? Math.min(rect.width, Math.max(0, bounds.width)) : rect.width;
      const height = bounds ? Math.min(rect.height, Math.max(0, bounds.height)) : rect.height;
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
      element.style.scale = bounds ? "1" : "";
      element.style.overflow = bounds ? "hidden" : "";
      const left = rect.left + point.clientX - pointer.clientX;
      const top = rect.top + point.clientY - pointer.clientY;
      const x = bounds ? Math.max(bounds.left, Math.min(left, bounds.right - width)) : left;
      const y = bounds ? Math.max(bounds.top, Math.min(top, bounds.bottom - height)) : top;
      element.style.transform = `translate3d(${x - rect.left}px, ${y - rect.top}px, 0)`;
    },
    settleTo(target, onDone) {
      if (done) return;
      window.clearTimeout(timer);
      const { ms, easing } = motionDuration();
      if (!target || ms === 0) {
        preview.dispose();
        onDone?.();
        return;
      }
      label?.remove();
      label = null;
      element.style.removeProperty("overflow");
      element.style.removeProperty("scale");
      element.style.width = `${rect.width}px`;
      element.style.height = `${rect.height}px`;
      delete element.dataset.lifted;
      delete element.dataset.action;
      element.style.transition = `transform ${ms}ms ${easing}, scale ${ms}ms ${easing}, box-shadow ${ms}ms ${easing}`;
      element.style.transform = `translate3d(${target.left - rect.left}px, ${target.top - rect.top}px, 0)`;
      timer = setTimeout(() => {
        preview.dispose();
        onDone?.();
      }, ms + 40);
    },
    dispose() {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      element.remove();
      if (activePreview === preview) activePreview = null;
    },
  };
  activePreview = preview;
  return preview;
}

/**
 * Opens a gap in a list while one of its items is dragged: the source item collapses to nothing and
 * the item next to the insertion point gets padding the size of the source, so the neighbours (and
 * every container around them) flow apart exactly as they will after the drop. Layout, not
 * transforms, so folders and groups grow with it; only the two touched items animate. Padding, not
 * margin, because a windowed list positions its rows from their measured border boxes: a margin
 * would leave the following rows in place and the target would slide over them.
 */
export type ListGap = {
  /** Open the gap before/after `target`; `null` (or the source itself) restores the source slot. */
  open(target: HTMLElement | null, place?: "before" | "after"): void;
  /** Remove every inline style this gap added, immediately. */
  release(): void;
};

function rowGap(container: Element | null) {
  const gap = container ? Number.parseFloat(getComputedStyle(container).rowGap) : 0;
  return Number.isFinite(gap) ? gap : 0;
}

type GapSide = "padding-block-start" | "padding-block-end";

export function createListGap(source: HTMLElement): ListGap {
  const { ms, easing } = motionDuration();
  const transition = ms
    ? `height ${ms}ms ${easing}, margin ${ms}ms ${easing}, padding ${ms}ms ${easing}`
    : "";
  const sourceHeight = source.getBoundingClientRect().height;
  const sourceGap = rowGap(source.parentElement);
  const touched = new Set<HTMLElement>();
  let collapsed = false;
  let spacer: { element: HTMLElement; side: GapSide; base: number } | null = null;

  const touch = (element: HTMLElement) => {
    touched.add(element);
    if (transition) element.style.transition = transition;
  };
  touch(source);
  source.style.height = `${sourceHeight}px`;
  source.style.overflow = "hidden";

  const closeSpacer = () => {
    if (spacer) spacer.element.style.setProperty(spacer.side, `${spacer.base}px`);
    spacer = null;
  };

  return {
    open(target, place = "before") {
      const wantCollapsed = !!target && target !== source;
      if (wantCollapsed !== collapsed) {
        collapsed = wantCollapsed;
        source.style.height = collapsed ? "0px" : `${sourceHeight}px`;
        // The flex gap that used to separate the source from its neighbour must not stay behind.
        source.style.setProperty("margin-block-end", collapsed ? `${-sourceGap}px` : "0px");
      }
      if (!wantCollapsed || !target) {
        closeSpacer();
        return;
      }
      const side: GapSide = place === "before" ? "padding-block-start" : "padding-block-end";
      if (spacer?.element === target && spacer.side === side) return;
      closeSpacer();
      touch(target);
      const base = Number.parseFloat(getComputedStyle(target).getPropertyValue(side)) || 0;
      const neighbour =
        place === "before" ? target.previousElementSibling : target.nextElementSibling;
      const gap = neighbour ? rowGap(target.parentElement) : 0;
      target.style.setProperty(side, `${base + sourceHeight + gap}px`);
      spacer = { element: target, side, base };
    },
    release() {
      for (const element of touched) {
        for (const property of [
          "height",
          "overflow",
          "margin-block-end",
          "padding-block-start",
          "padding-block-end",
          "transition",
        ]) {
          element.style.removeProperty(property);
        }
        if (!element.getAttribute("style")) element.removeAttribute("style");
      }
      touched.clear();
      spacer = null;
      collapsed = false;
    },
  };
}
