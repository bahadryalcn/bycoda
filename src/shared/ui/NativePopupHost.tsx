import {
  createContext,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
  type CSSProperties,
  type ReactNode,
} from "react";
import { observeResize } from "../lib/observeResize";
import { POPUP_MAX_WIDTH, popupListWidth, type Size } from "../lib/popover";
import styles from "./Popover.module.css";

export { POPUP_MAX_WIDTH, POPUP_VIEWPORT_PADDING, popupListWidth } from "../lib/popover";

/** Shared frame class for native-window popup roots; content still uses Popover and shared rows. */
export const nativePopupFrameClassName = styles.frame;

/**
 * Floating glass shared by Popover and app-rendered native popup roots.
 * @group overlay
 * @use Backdrop inside a positioned shared popup frame.
 * @avoid Complete in-app floating content: Popover. OS-window roots use useNativePopupFrame.
 */
export function PopupBackdrop({
  solid = false,
  frosted = false,
}: {
  solid?: boolean;
  frosted?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={
        solid
          ? "popover-solid pointer-events-none absolute inset-0 z-0 rounded-[inherit]"
          : `pointer-events-none absolute inset-0 z-0 [border-radius:inherit] backdrop-blur-xl popover-backdrop${frosted ? " popover-frosted" : ""}`
      }
    />
  );
}

export type NativePopupFrameOptions = {
  minWidth?: number;
  /** Rounded outer dimensions in viewport CSS pixels; owner handles CSS zoom and OS scaling. */
  onContentSize?: (size: Size) => void;
  ref?: Ref<HTMLDivElement>;
};

/**
 * Props for an existing OS popup root. Render PopupBackdrop followed by a content element with
 * contentClassName inside frameProps. Window owner keeps NativePopupHost.Provider and fit transport.
 * Reports size on mount and resize; never creates, moves or fits an OS window.
 */
export function useNativePopupFrame({
  minWidth = 0,
  onContentSize,
  ref,
}: NativePopupFrameOptions = {}) {
  const frame = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- observes frame dimensions so async content changes resize the owning OS window
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node || !onContentSize) return;
    let previous = "";
    const report = () => {
      const bounds = node.getBoundingClientRect();
      const size = {
        width: Math.ceil(popupListWidth(bounds.width, minWidth)),
        height: Math.ceil(bounds.height),
      };
      const key = `${size.width}:${size.height}`;
      if (key === previous) return;
      previous = key;
      onContentSize(size);
    };
    report();
    return observeResize(node, report);
  }, [onContentSize, minWidth]);
  return {
    frameProps: {
      ref: (node: HTMLDivElement | null) => {
        frame.current = node;
        if (typeof ref === "function") return ref(node);
        if (ref) ref.current = node;
      },
      className: `${styles.frame} ${styles.nativeFrame}`,
      style: {
        "--popup-min-width": `${popupListWidth(0, minWidth)}px`,
        "--popup-max-width": `${POPUP_MAX_WIDTH}px`,
      } as CSSProperties,
    },
    contentClassName: styles.nativeContent,
  };
}

/**
 * Context holding the native popup window element a surface is rendered into, so nested overlays skip their own
 * positioning, clipping and shadow. Provided by popup roots; consumed by Popover and menus.
 * @status internal
 * @group overlay
 * @use Hosting the native popup window content and its dismissal bridge.
 * @avoid An in-window anchored popup: Popover.
 */
export const NativePopupHost = createContext<HTMLElement | null>(null);

/**
 * Shared popup frame inside an existing OS window. Owns backdrop, scroll bound
 * and native host context; the caller owns native transport and dismissal.
 * @group overlay
 * @use Contents of an already-created native popup window, through Popover's public export.
 * @avoid Anchored content inside the current window: Popover.
 */
export function NativePopover({
  children,
  maxHeight,
  ref,
  ...options
}: NativePopupFrameOptions & { children: ReactNode; maxHeight: number }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const { frameProps, contentClassName } = useNativePopupFrame({
    ...options,
    ref: (node) => {
      setHost(node);
      if (typeof ref === "function") return ref(node);
      if (ref) ref.current = node;
    },
  });
  return (
    <div {...frameProps}>
      <PopupBackdrop />
      <div
        className={`${contentClassName} max-h-[var(--native-popup-max-height)] overflow-y-auto`}
        style={{ "--native-popup-max-height": `${maxHeight}px` } as CSSProperties}
      >
        {host ? <NativePopupHost value={host}>{children}</NativePopupHost> : null}
      </div>
    </div>
  );
}
