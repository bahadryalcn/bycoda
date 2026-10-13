import { createContext, useContext, useLayoutEffect, useRef } from "react";
import { isImeComposition } from "../lib/keyboard";

export const OverlayParent = createContext<symbol | null>(null);
/** Minimum layer for menus portalled out of the current surface. */
export const OverlayMenuLayer = createContext(0);
type Entry = {
  id: symbol;
  parent: symbol | null;
  root: HTMLElement;
  modal: boolean;
  escape?: () => void;
  previous: HTMLElement | null;
};
const entries: Entry[] = [];
/** Outer window listeners must leave Escape to the active overlay stack. */
export function hasActiveOverlay() {
  return entries.length > 0;
}
const inert = new Map<HTMLElement, boolean>();
let observer: MutationObserver | undefined;
function visible(element: HTMLElement) {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (
      current.inert ||
      current.hidden ||
      style.display === "none" ||
      style.visibility === "hidden"
    )
      return false;
  }
  return true;
}
const focusable = (root: HTMLElement) =>
  [
    root,
    ...root.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]"),
  ].filter((el) => el.tabIndex >= 0 && !el.matches(":disabled") && visible(el));
function descendant(entry: Entry, id: symbol): boolean {
  if (entry.id === id) return true;
  const parent = entries.find((item) => item.id === entry.parent);
  return parent ? descendant(parent, id) : entry.parent === id;
}
/** Portalled child surfaces still belong to their logical parent overlay. */
export function overlayContainsTarget(id: symbol, target: Node): boolean {
  return entries.some((entry) => descendant(entry, id) && entry.root.contains(target));
}
function modalRoots() {
  const modal = [...entries].reverse().find((entry) => entry.modal);
  return modal
    ? entries.filter((entry) => descendant(entry, modal.id)).map((entry) => entry.root)
    : [];
}
function syncInert() {
  for (const [el, original] of inert) el.inert = original;
  inert.clear();
  const roots = modalRoots();
  if (!roots.length) return;
  const visit = (el: HTMLElement) => {
    if (roots.some((root) => root === el)) return;
    if (roots.some((root) => el.contains(root))) {
      for (const child of el.children) if (child instanceof HTMLElement) visit(child);
    } else {
      inert.set(el, el.inert);
      el.inert = true;
    }
  };
  for (const child of document.body.children) if (child instanceof HTMLElement) visit(child);
}
function onKey(event: KeyboardEvent) {
  if (event.defaultPrevented || isImeComposition(event)) return;
  if (event.key === "Escape") {
    const top = entries[entries.length - 1];
    if (!top?.escape) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    top.escape();
  } else if (event.key === "Tab") {
    const roots = modalRoots();
    if (!roots.length) return;
    const options = [...new Set(roots.flatMap(focusable))];
    const index = options.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? index <= 0
        ? options.length - 1
        : index - 1
      : (index + 1) % options.length;
    event.preventDefault();
    (options[next] ?? roots[0]).focus({ preventScroll: true });
  }
}
function onFocus(event: FocusEvent) {
  const roots = modalRoots();
  if (roots.length && !roots.some((root) => root.contains(event.target as Node))) {
    (focusable(roots[0])[0] ?? roots[0]).focus({ preventScroll: true });
  }
}
export function useOverlay(
  root: { current: HTMLElement | null },
  modal: boolean,
  escape?: () => void,
  enabled = true,
) {
  const id = useRef(Symbol("overlay")).current;
  // Capture before descendant layout effects can move focus into their portals.
  const previous = useRef(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const parent = useContext(OverlayParent);
  const close = useRef(escape);
  close.current = escape;
  useLayoutEffect(() => {
    if (!enabled || !root.current) return;
    const entry: Entry = {
      id,
      parent,
      root: root.current,
      modal,
      escape: escape ? () => close.current?.() : undefined,
      previous: previous.current,
    };
    // Child layout effects run first: insert ancestors before their descendants.
    const child = entries.findIndex((item) => descendant(item, id));
    entries.splice(child < 0 ? entries.length : child, 0, entry);
    if (entries.length === 1) {
      window.addEventListener("keydown", onKey, true);
      document.addEventListener("focusin", onFocus);
      observer = new MutationObserver(syncInert);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    syncInert();
    if (modal && modalRoots()[0] === entry.root)
      (focusable(entry.root)[0] ?? entry.root).focus({ preventScroll: true });
    return () => {
      const wasTop = entries[entries.length - 1] === entry;
      entries.splice(entries.indexOf(entry), 1);
      syncInert();
      if (!entries.length) {
        window.removeEventListener("keydown", onKey, true);
        document.removeEventListener("focusin", onFocus);
        observer?.disconnect();
      }
      if (
        (wasTop || entry.modal) &&
        entry.previous?.isConnected &&
        !entry.previous.closest("[inert]")
      )
        entry.previous.focus({ preventScroll: true });
    };
  }, [id, parent, root, modal, Boolean(escape), enabled]);
  return id;
}
