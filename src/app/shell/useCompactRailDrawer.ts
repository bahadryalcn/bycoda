import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The sidebar drawer beside the compact project rail. With the sidebar
 * collapsed, the rail's tab shortcuts open it temporarily until the user clicks
 * away. Also owns the anchor of the rail's project navigation popup, which only
 * exists while the compact rail is shown.
 */
export function useCompactRailDrawer({
  compactRailVisible,
  open,
  sidebarAvailable,
}: {
  compactRailVisible: boolean;
  /** The sidebar is pinned open. */
  open: boolean;
  sidebarAvailable: boolean;
}) {
  const [projectNavigationAnchor, setProjectNavigationAnchor] = useState<HTMLElement | null>(null);
  if (!compactRailVisible && projectNavigationAnchor) setProjectNavigationAnchor(null);
  const closeProjectNavigationThen = (action?: () => void) =>
    action
      ? () => {
          setProjectNavigationAnchor(null);
          action();
        }
      : undefined;

  const drawerMode = compactRailVisible && !open;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerVisible = drawerMode && drawerOpen && sidebarAvailable;
  // A dismissed drawer stays mounted while it slides shut. Anything that takes
  // its place (the pinned sidebar, another view) drops it at once.
  const [drawerMounted, setDrawerMounted] = useState(false);
  const drawerClosing = drawerMounted && !drawerVisible && drawerMode && sidebarAvailable;
  const drawerRendered = drawerVisible || drawerClosing;
  const drawerAnimation = useRef<Animation | null>(null);

  if (drawerOpen && (!drawerMode || !sidebarAvailable)) setDrawerOpen(false);
  if (drawerMounted !== drawerVisible && !drawerClosing) setDrawerMounted(drawerVisible);

  // Grow the drawer's width so the workspace is pushed along with it. A
  // reversal mid-slide starts from wherever the width currently is.
  useLayoutEffect(() => {
    const drawer = drawerRef.current;
    if (!drawerRendered || !drawer) {
      drawerAnimation.current = null;
      return;
    }
    const full =
      drawer.firstElementChild instanceof HTMLElement ? drawer.firstElementChild.offsetWidth : 0;
    const from = drawerAnimation.current
      ? drawer.getBoundingClientRect().width
      : drawerClosing
        ? full
        : 0;
    drawerAnimation.current?.cancel();
    drawerAnimation.current = null;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (typeof drawer.animate !== "function" || reduceMotion) {
      if (drawerClosing) setDrawerMounted(false);
      return;
    }
    const animation = drawer.animate(
      [{ width: `${from}px` }, { width: `${drawerClosing ? 0 : full}px` }],
      drawerClosing
        ? {
            duration: 160,
            easing: "cubic-bezier(0.4, 0, 1, 1)",
            fill: "forwards",
          }
        : { duration: 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    drawerAnimation.current = animation;
    animation.onfinish = () => {
      if (drawerAnimation.current !== animation) return;
      drawerAnimation.current = null;
      if (drawerClosing) setDrawerMounted(false);
    };
  }, [drawerRendered, drawerClosing]);

  useEffect(() => {
    if (!drawerVisible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setDrawerOpen(false);
    };
    // The rail's own shortcuts toggle the drawer, and menus opened from it
    // stay usable; anything else dismisses it.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      const el = target instanceof Element ? target : null;
      if (drawerRef.current?.contains(el)) return;
      if (el?.closest("[data-compact-project-rail],[data-popover-side]")) {
        return;
      }
      setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [drawerVisible]);

  return {
    drawerMode,
    drawerVisible,
    drawerRendered,
    drawerClosing,
    drawerRef,
    setDrawerOpen,
    projectNavigationAnchor,
    setProjectNavigationAnchor,
    closeProjectNavigationThen,
  };
}
