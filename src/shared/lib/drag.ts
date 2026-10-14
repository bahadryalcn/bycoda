export const EXPLORER_FILE_POINTER_DRAG_EVENT = "bycoda:explorer-file-pointer-drag";

export type ExplorerFilePointerDragDetail =
  | { type: "move" | "drop"; path: string; paths?: string[]; x: number; y: number }
  | { type: "end"; path: string };

export function emitExplorerFilePointerDrag(detail: ExplorerFilePointerDragDetail) {
  window.dispatchEvent(
    new CustomEvent<ExplorerFilePointerDragDetail>(EXPLORER_FILE_POINTER_DRAG_EVENT, { detail }),
  );
}

let dropHint: HTMLDivElement | null = null;
let grabbing = false;

function setDragCursor(cursor: string) {
  document.body.style.cursor = cursor;
  document.body.style.setProperty("--workspace-drag-cursor", cursor || "auto");
}

/** Shared pointer feedback; the badge never intercepts hit testing. */
export function setDropFeedback(
  action: "move" | "window" | "blocked",
  pointer: { clientX: number; clientY: number },
  label?: string,
) {
  setDragCursor(action === "blocked" ? "not-allowed" : action === "window" ? "alias" : "move");
  if (!dropHint) {
    dropHint = document.createElement("div");
    dropHint.className = "pointer-drop-hint";
    dropHint.setAttribute("aria-hidden", "true");
    document.body.append(dropHint);
  }
  dropHint.dataset.action = action;
  dropHint.textContent =
    label ??
    (action === "blocked"
      ? "Cannot drop here"
      : action === "window"
        ? "Move to another window"
        : "Release to move");
  dropHint.style.left = `${Math.max(8, Math.min(pointer.clientX + 18, window.innerWidth - dropHint.offsetWidth - 8))}px`;
  dropHint.style.top = `${Math.max(8, Math.min(pointer.clientY + 22, window.innerHeight - dropHint.offsetHeight - 8))}px`;
}

export function clearDropFeedback() {
  dropHint?.remove();
  dropHint = null;
  if (grabbing) setDragCursor("grabbing");
  else {
    document.body.style.cursor = "";
    document.body.style.removeProperty("--workspace-drag-cursor");
  }
}

export function setGrabbing(on: boolean) {
  grabbing = on;
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
