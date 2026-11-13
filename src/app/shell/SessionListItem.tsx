import styles from "./Sidebar.module.css";
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { remoteProjectFor } from "../../features/connections/model/remoteProjects";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import { useLocale } from "../../shared/i18n";
import type { SessionInsertMotion } from "./useSessionListMotion";
import type { SessionListVirtualProps } from "./sessionListWindow";

const SESSION_INSERT_WINDOW_MS = 15_000;

/** Rows created recently slide in; list virtualization measures the same list item. */
export function SessionListItem({
  session,
  cwd,
  motion,
  children,
  virtual,
  depth = 0,
  folderId,
  groupSection,
}: {
  session: SessionSummary;
  cwd: string;
  motion: RefObject<SessionInsertMotion>;
  children: ReactNode;
  virtual?: SessionListVirtualProps;
  depth?: number;
  folderId?: string;
  groupSection?: "pinned" | "reminders" | "settled";
}) {
  useLocale();
  const ref = useRef<HTMLLIElement>(null);
  const virtualRef = virtual?.ref;
  const setRef = (element: HTMLLIElement | null) => {
    ref.current = element;
    virtualRef?.(element);
  };
  const played = useRef(false);
  useLayoutEffect(() => {
    if (played.current) return;
    played.current = true;
    const state = motion.current;
    const fresh =
      state.cwd === cwd &&
      !state.seen.has(session.id) &&
      !document.hidden &&
      ((session.createdAt === 0 && !remoteProjectFor(session.cwd)) ||
        (session.createdAt >= state.since &&
          Date.now() - session.createdAt < SESSION_INSERT_WINDOW_MS));
    state.seen.add(session.id);
    const el = ref.current;
    const content = el?.firstElementChild;
    if (
      !fresh ||
      !el ||
      !(content instanceof HTMLElement) ||
      typeof el.animate !== "function" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const offset =
      el.offsetHeight + (parseFloat(getComputedStyle(el.parentElement ?? el).rowGap) || 0);
    const animations: Animation[] = [];
    const timing = { duration: 380, easing: "cubic-bezier(0.32, 0.72, 0, 1)" };
    for (
      let node: Element | null = el;
      node && !node.hasAttribute("data-session-list");
      node = node.parentElement
    ) {
      for (let below = node.nextElementSibling; below; below = below.nextElementSibling) {
        if (!(below instanceof HTMLElement)) continue;
        animations.push(
          below.animate([{ transform: `translateY(${-offset}px)` }, { transform: "none" }], {
            ...timing,
            composite: "add",
          }),
        );
      }
    }
    animations.push(
      content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" }),
    );
    for (const animation of animations) {
      if (animation) void animation.finished.catch(() => undefined);
    }
    const stop = () => animations.forEach((animation) => animation?.cancel());
    const onVisibility = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, []);
  return (
    <li
      {...virtual}
      ref={setRef}
      data-index={virtual?.["data-index"]}
      data-session-folder-owner={folderId}
      data-session-section={groupSection}
      className={`${virtual?.className ?? ""} ${styles.folder}`}
      style={
        {
          ...virtual?.style,
          "--session-folder-indent": depth ? `${depth * 1.375}rem` : undefined,
        } as React.CSSProperties
      }
    >
      {children}
    </li>
  );
}
