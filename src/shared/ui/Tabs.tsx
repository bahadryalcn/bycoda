import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Badge } from "./Badge";
import { Button, type ButtonProps } from "./Button";
import styles from "./Tabs.module.css";

export type TabsOrientation = "horizontal" | "vertical";
/** `automatic` selects as arrow keys move focus; `manual` moves focus only and Enter/Space selects. */
export type TabsActivation = "automatic" | "manual";
/** `tab` is the shared strip look (Button `variant="tab"`); `item` is a start-aligned
 *  navigation row (Button `variant="item"`), the default for vertical lists. */
export type TabsVariant = "tab" | "item";
/** Where `aria-controls` points: one panel per tab, one panel shared by every tab, or none
 *  (the caller passes `controls` per tab, or the strip switches a view it does not own). */
export type TabsPanels = "each" | "shared" | "none";

type TabsContextValue = {
  value: string;
  select: (value: string) => void;
  activation: TabsActivation;
  orientation: TabsOrientation;
  variant: TabsVariant;
  size: "sm" | "md";
  fill: boolean;
  responsive: boolean;
  panels: TabsPanels;
  tabId: (value: string) => string;
  panelId: (value?: string) => string;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(component: string) {
  const context = useContext(TabsContext);
  if (!context) throw new Error(`${component} must be rendered inside <Tabs>`);
  return context;
}

const idPart = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_");

export type TabsProps<T extends string = string> = {
  /** Selected tab value. Controlled: the caller owns persistence. */
  value: T;
  onValueChange: (value: T) => void;
  activation?: TabsActivation;
  orientation?: TabsOrientation;
  /** Default `tab` horizontally, `item` vertically. */
  variant?: TabsVariant;
  /** Control height from the shared density tokens (`--ui-control-height-*`). Default `sm`. */
  size?: "sm" | "md";
  /** Stretch tabs to equal shares of the strip. */
  fill?: boolean;
  /** Fold labels to the icon (and counts to a dot) as each tab narrows. Implies `fill`. */
  responsive?: boolean;
  panels?: TabsPanels;
  /** Base for the generated tab/panel ids: `${id}-tab-${value}`, `${id}-panel-${value}`
   *  (`${id}-panel` for a shared panel). Defaults to a React id. */
  id?: string;
  children: ReactNode;
};

/**
 * Tab state and ids for one `TabList` and its `TabPanel`s. Renders no element; the caller owns `value` and
 * persistence. Look is Button `tab` (strip) or `item` (vertical navigation); `responsive` folds labels to icons.
 *
 * Arrow keys (Left/Right, or Up/Down when vertical; RTL aware), Home and End move between
 * enabled tabs. Only one tab is a tab stop. Keys with Alt/Ctrl/Meta, or that a tab's own
 * `onKeyDown` already handled (`preventDefault`), are left to the caller, e.g. Alt+Arrow
 * reordering. Put selection side effects in `onValueChange`: keyboard selection does not
 * call a tab's `onClick`.
 * @group navigation
 * @use Switch between views or panels of one context with roving focus and linked panel ids.
 * @avoid Exclusive filter or display mode over one content area: SegmentedControl. Draggable editor or workspace document tabs: SurfaceTabs. Views with no panel to link: TabStrip.
 * @replaces role=tab role=tablist
 *
 * @example
 * <Tabs value={tab} onValueChange={setTab}>
 *   <TabList label={t("Pull request")}>
 *     <Tab value="summary">{t("Summary")}</Tab>
 *     <Tab value="checks" count={failing} countLabel={t("{p0} failing", { p0: failing })}>
 *       {t("Checks")}
 *     </Tab>
 *   </TabList>
 *   <TabPanel value="summary">…</TabPanel>
 *   <TabPanel value="checks">…</TabPanel>
 * </Tabs>
 */
export function Tabs<T extends string = string>({
  value,
  onValueChange,
  activation = "automatic",
  orientation = "horizontal",
  variant,
  size = "sm",
  fill = false,
  responsive = false,
  panels = "each",
  id,
  children,
}: TabsProps<T>) {
  const generated = useId();
  const base = id ?? generated;
  const context: TabsContextValue = {
    value,
    select: (next) => {
      if (next !== value) onValueChange(next as T);
    },
    activation,
    orientation,
    variant: variant ?? (orientation === "vertical" ? "item" : "tab"),
    size,
    fill: fill || responsive,
    responsive,
    panels,
    tabId: (tab) => `${base}-tab-${idPart(tab)}`,
    panelId: (tab) => (tab === undefined ? `${base}-panel` : `${base}-panel-${idPart(tab)}`),
  };
  return <TabsContext.Provider value={context}>{children}</TabsContext.Provider>;
}

/** Tabs owned by this list, in DOM order; nested tab lists keep their own. */
function ownTabs(list: HTMLElement) {
  return [...list.querySelectorAll<HTMLElement>('[role="tab"]')].filter(
    (tab) => tab.closest('[role="tablist"]') === list,
  );
}
const enabled = (tab: HTMLElement) =>
  !tab.hasAttribute("disabled") && tab.getAttribute("aria-disabled") !== "true";

export type TabItem<T extends string = string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  count?: number | null;
  countLabel?: string;
  disabled?: boolean;
  tooltip?: string;
};

export type TabListProps = Omit<ComponentPropsWithRef<"div">, "role" | "aria-label"> & {
  /** Accessible name of the strip. Use `aria-labelledby` instead when a visible heading names it. */
  label?: string;
  "aria-labelledby"?: string;
  /** Data-driven tabs, as an alternative to `<Tab>` children. */
  items?: readonly TabItem[];
};

/**
 * The `role="tablist"` strip. Children are `Tab`s, optionally inside caller wrappers
 * (tooltips, sortable rows); the roving keys find them through the DOM.
 *
 * Responsive hooks: the list carries `data-fill`/`data-responsive`, and each tab marks its
 * parts with `data-tab-part="label" | "count" | "dot"`, so a feature stylesheet can define
 * its own container steps (as `.bycoda-workspace-tabs` does) through `className`.
 * @group navigation
 * @status internal
 */
export function TabList({
  label,
  items,
  className,
  children,
  onKeyDown,
  ref,
  ...props
}: TabListProps) {
  const tabs = useTabs("TabList");
  const listRef = useRef<HTMLDivElement | null>(null);

  // Exactly one tab stop: the selected enabled tab, else the first enabled one (a value
  // that matches no tab, or a disabled selection, must not leave the strip unreachable).
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const all = ownTabs(list);
    const stop =
      all.find((tab) => tab.getAttribute("aria-selected") === "true" && enabled(tab)) ??
      all.find(enabled);
    for (const tab of all) tab.tabIndex = tab === stop ? 0 : -1;
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const list = event.currentTarget;
    const current = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (!current || current.closest('[role="tablist"]') !== list) return;
    const all = ownTabs(list).filter(enabled);
    const index = all.indexOf(current);
    const vertical = tabs.orientation === "vertical";
    const rtl = !vertical && getComputedStyle(list).direction === "rtl";
    const forward = vertical ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
    const backward = vertical ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";
    const target =
      event.key === forward
        ? all[(index + 1) % all.length]
        : event.key === backward
          ? all[(index - 1 + all.length) % all.length]
          : event.key === "Home"
            ? all[0]
            : event.key === "End"
              ? all[all.length - 1]
              : undefined;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    target.focus();
    const next = target.dataset.tabValue;
    if (tabs.activation === "automatic" && next !== undefined) tabs.select(next);
  };

  return (
    <div
      {...props}
      ref={(node) => {
        listRef.current = node;
        if (typeof ref === "function") return ref(node);
        if (ref) ref.current = node;
      }}
      role="tablist"
      aria-label={label}
      aria-orientation={tabs.orientation}
      data-fill={tabs.fill || undefined}
      data-responsive={tabs.responsive || undefined}
      className={[styles.list, className].filter(Boolean).join(" ")}
      onKeyDown={handleKeyDown}
    >
      {items
        ? items.map((item) => (
            <Tab
              key={item.value}
              value={item.value}
              icon={item.icon}
              count={item.count}
              countLabel={item.countLabel}
              disabled={item.disabled}
              tooltip={item.tooltip}
            >
              {item.label}
            </Tab>
          ))
        : children}
    </div>
  );
}

/** Icon-only tab (a provider rail): the glyph is the child and `label` is its accessible name. */
type TabLabel = { iconOnly: true; label: string } | { iconOnly?: false; label?: string };

type TabBase = Omit<
  ButtonProps,
  "value" | "variant" | "size" | "role" | "iconOnly" | "label" | "startIcon" | "selected"
> & {
  value: string;
  /** Leading glyph from `icons.tsx`; Button sizes it from the shared icon scale. */
  icon?: ReactNode;
  /** Optional count, rendered as `Badge variant="count"`. `null`/`undefined` renders nothing;
   *  0 renders "0" (pass `null` to hide an empty count). */
  count?: number | null;
  /** Accessible context for the count, such as "3 failing". */
  countLabel?: string;
  /** Counts above this render as `max+`. Default 99. */
  countMax?: number;
  /** Extra content after the label and count (a dirty dot, a diff stat). */
  accessory?: ReactNode;
  /** Override `aria-controls` (otherwise derived from `<Tabs panels>`). */
  controls?: string;
};

export type TabProps = TabBase & TabLabel;

/**
 * One tab: shared Button `tab` (or `item`) presentation with `role="tab"`, ids,
 * `aria-selected`, `aria-controls` and the roving tab stop. Extra Button props
 * (`tooltip`, `onKeyDown`, `onContextMenu`, `data-*`, `ref`) pass through.
 * @group navigation
 * @status internal
 */
export function Tab({
  value,
  iconOnly,
  label,
  icon,
  count,
  countLabel,
  countMax = 99,
  accessory,
  controls,
  id,
  className,
  children,
  onClick,
  ...props
}: TabProps) {
  const tabs = useTabs("Tab");
  const selected = tabs.value === value;
  const panel =
    controls ??
    (tabs.panels === "each"
      ? tabs.panelId(value)
      : tabs.panels === "shared"
        ? tabs.panelId()
        : undefined);
  const hasCount = count !== null && count !== undefined;
  return (
    <Button
      {...(props as ButtonProps)}
      {...({ iconOnly, label } as { iconOnly: true; label: string })}
      variant={tabs.variant}
      size={tabs.size}
      motion="none"
      role="tab"
      id={id ?? tabs.tabId(value)}
      aria-selected={selected}
      aria-controls={panel}
      tabIndex={selected ? 0 : -1}
      data-tab-value={value}
      data-tab-has-icon={icon != null ? "" : undefined}
      startIcon={icon}
      className={className}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented) tabs.select(value);
      }}
    >
      {typeof children === "string" || typeof children === "number" ? (
        <span className={styles.label} data-tab-part="label">
          {children}
        </span>
      ) : (
        children
      )}
      {hasCount ? (
        <>
          <span className={styles.count} data-tab-part="count">
            <Badge variant="count" size="sm" tone="neutral" max={countMax} label={countLabel}>
              {count}
            </Badge>
          </span>
          <span className={styles.dot} data-tab-part="dot" aria-hidden="true" />
        </>
      ) : null}
      {accessory}
    </Button>
  );
}

export type TabPanelProps = Omit<ComponentPropsWithRef<"div">, "role"> & {
  /** The tab this panel belongs to. Omit for the single panel of `<Tabs panels="shared">`. */
  value?: string;
  /** Keep an unselected panel mounted (hidden), preserving drafts, scroll and editors. */
  keepMounted?: boolean;
  /** Override `aria-labelledby` when the tab uses a custom `id`. */
  labelledBy?: string;
};

/**
 * `role="tabpanel"`, labelled by its tab and focusable (`tabIndex` 0) unless overridden.
 * @group navigation
 * @status internal
 */
export function TabPanel({
  value,
  keepMounted = false,
  labelledBy,
  className,
  children,
  ...props
}: TabPanelProps) {
  const tabs = useTabs("TabPanel");
  const shared = value === undefined;
  const selected = shared || tabs.value === value;
  if (!selected && !keepMounted) return null;
  return (
    <div
      tabIndex={0}
      {...props}
      role="tabpanel"
      id={props.id ?? tabs.panelId(value)}
      aria-labelledby={labelledBy ?? tabs.tabId(shared ? tabs.value : value)}
      hidden={!selected}
      className={[styles.panel, className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

export type TabStripProps<T extends string = string> = Omit<TabsProps<T>, "children" | "panels"> &
  Omit<TabListProps, "items" | "id"> & {
    items: readonly TabItem<T>[];
    /** Id of the one region every tab controls (sets `aria-controls`); omit for none. */
    controls?: string;
  };

/**
 * Data-driven strip for the common case without `TabPanel` children: a view switcher whose
 * content lives elsewhere, or one shared region (`controls`).
 * @group navigation
 * @use Tab-style switcher from an `items` array (view switch, filter header) without per-tab panels.
 * @avoid Real panels per tab: Tabs with TabPanel. Exclusive mode choice: SegmentedControl. Draggable document tabs: SurfaceTabs.
 *
 * @example
 * <TabStrip
 *   label={t("Notifications")}
 *   value={view}
 *   onValueChange={setView}
 *   controls={listId}
 *   items={[
 *     { value: "pending", label: t("Pending"), count },
 *     { value: "history", label: t("Recent requests"), count: history.length },
 *   ]}
 * />
 */
export function TabStrip<T extends string = string>({
  value,
  onValueChange,
  activation,
  orientation,
  variant,
  size,
  fill,
  responsive,
  id,
  items,
  controls,
  ...list
}: TabStripProps<T>) {
  return (
    <Tabs
      value={value}
      onValueChange={onValueChange}
      activation={activation}
      orientation={orientation}
      variant={variant}
      size={size}
      fill={fill}
      responsive={responsive}
      panels="none"
      id={id}
    >
      <TabList {...list}>
        {items.map((item) => (
          <Tab
            key={item.value}
            value={item.value}
            icon={item.icon}
            count={item.count}
            countLabel={item.countLabel}
            disabled={item.disabled}
            tooltip={item.tooltip}
            controls={controls}
          >
            {item.label}
          </Tab>
        ))}
      </TabList>
    </Tabs>
  );
}
