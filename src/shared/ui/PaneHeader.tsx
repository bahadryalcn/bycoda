import type { ComponentPropsWithRef, ReactNode } from "react";
import { IS_MAC } from "../../platform/tauri/platform";
import styles from "./PaneHeader.module.css";

export type WindowChromeInsetProps = {
  /** Reserve the space only when this is true (e.g. `!besideRail`). Default true. */
  active?: boolean;
  /** `traffic-lights` (78px, `--ui-window-chrome-inset`) beside the macOS window buttons;
   *  `compact` (16px) where a compact rail already holds them. */
  size?: "traffic-lights" | "compact";
  className?: string;
};

/**
 * The space a header row leaves for the macOS traffic lights. Renders nothing on other
 * platforms, so it replaces `{IS_MAC ? <div className="w-[78px] shrink-0" /> : null}`.
 *
 * @example
 * <div className="flex items-center" data-tauri-drag-region="deep">
 *   <WindowChromeInset active={!besideRail} />
 *   …
 * </div>
 */
export function WindowChromeInset({
  active = true,
  size = "traffic-lights",
  className,
}: WindowChromeInsetProps) {
  if (!IS_MAC || !active) return null;
  return (
    <span
      aria-hidden="true"
      data-window-chrome-inset={size}
      className={[styles.chromeInset, className].filter(Boolean).join(" ")}
    />
  );
}

export type PaneHeaderProps = Omit<ComponentPropsWithRef<"div">, "title"> & {
  /** The pane's name. Plain text truncates with an ellipsis; a node (picker, breadcrumb) is placed as is. */
  title?: ReactNode;
  /** Element for the title. Default `h2`; use `div` when the pane already has a heading. */
  titleAs?: "h1" | "h2" | "h3" | "div";
  titleId?: string;
  /** Before the title: back/navigation controls. */
  leading?: ReactNode;
  /** Glyph before the title, drawn in secondary ink at the small icon size. */
  icon?: ReactNode;
  /** Secondary text after the title (count, branch, path). */
  meta?: ReactNode;
  /** Trailing actions: ghost icon Buttons, overflow menu. */
  actions?: ReactNode;
  /** After the actions, flush to the end: window controls on Windows/Linux. */
  trailing?: ReactNode;
  /** Reserve the macOS traffic-light space at the start (no-op elsewhere). */
  chromeInset?: boolean | "compact";
  /** Make the row a window drag region (`data-tauri-drag-region`). `true` = `"deep"`
   *  (children drag too); control slots are always excluded. */
  dragRegion?: boolean | "deep" | "self";
  /** Bottom hairline (`--ui-pane-border`). Default true. */
  bordered?: boolean;
  /** `div` (default) or `header`. A `header` outside a section reads as a page banner. */
  as?: "div" | "header";
};

/**
 * Compact pane/tool header that can double as a title bar: height
 * `calc(var(--ui-control-height-compact) + 0.5rem)` (override with `--ui-pane-header-height`),
 * a `--ui-pane-border` hairline and a secondary-size medium title in content ink.
 * `children` fill the space between the title and the actions (tabs, a search field).
 * For dialogs, sheets and popovers use `PanelHeader`.
 *
 * @example
 * <PaneHeader
 *   chromeInset={!besideRail}
 *   dragRegion
 *   leading={<OverlayNav onBack={onClose} />}
 *   icon={<Inbox />}
 *   title={t("Inbox")}
 *   meta={t("{p0} unread", { p0: unread })}
 *   actions={<Button variant="ghost" iconOnly label={t("Refresh")} …><RefreshCw /></Button>}
 *   trailing={IS_MAC ? null : <WindowControls />}
 * />
 */
export function PaneHeader({
  title,
  titleAs: Title = "h2",
  titleId,
  leading,
  icon,
  meta,
  actions,
  trailing,
  chromeInset = false,
  dragRegion = false,
  bordered = true,
  as: Root = "div",
  className,
  children,
  ...props
}: PaneHeaderProps) {
  const drag = dragRegion === true ? "deep" : dragRegion === "self" ? "" : dragRegion || undefined;
  const noDrag = drag !== undefined ? "false" : undefined;
  const inset = chromeInset !== false && IS_MAC;
  return (
    <Root
      {...props}
      data-tauri-drag-region={drag}
      data-drag-region={drag !== undefined || undefined}
      data-bordered={bordered || undefined}
      data-chrome-inset={inset || undefined}
      className={[styles.header, className].filter(Boolean).join(" ")}
    >
      {chromeInset !== false ? (
        <WindowChromeInset size={chromeInset === "compact" ? "compact" : "traffic-lights"} />
      ) : null}
      {leading != null ? (
        <div className={styles.leading} data-tauri-drag-region={noDrag}>
          {leading}
        </div>
      ) : null}
      {title != null || icon != null || meta != null ? (
        <div className={styles.heading}>
          {icon != null ? (
            <span className={styles.icon} aria-hidden="true">
              {icon}
            </span>
          ) : null}
          {title != null ? (
            <Title id={titleId} className={styles.title}>
              {title}
            </Title>
          ) : null}
          {meta != null ? <span className={styles.meta}>{meta}</span> : null}
        </div>
      ) : null}
      {children != null ? <div className={styles.body}>{children}</div> : null}
      {actions != null ? (
        <div className={styles.actions} data-tauri-drag-region={noDrag}>
          {actions}
        </div>
      ) : null}
      {trailing != null ? (
        <div className={styles.trailing} data-tauri-drag-region={noDrag}>
          {trailing}
        </div>
      ) : null}
    </Root>
  );
}
