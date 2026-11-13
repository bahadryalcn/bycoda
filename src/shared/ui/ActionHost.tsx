import type {
  ComponentPropsWithRef,
  CSSProperties,
  DragEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
} from "react";
import { Button, controlPaddingStyle, type ButtonProps, type ControlPadding } from "./Button";
import { MoreHorizontal } from "./icons";
import type { TextSize, TextTone } from "./Text";
import styles from "./ActionHost.module.css";

export type ActionHostElement = "div" | "article" | "li" | "section" | "aside";

export type ActionHostProps = ComponentPropsWithRef<"div"> & {
  /** Rendered element. Default `div`; use `article` for a card or `li` for a list item so the
   *  host carries the right semantics. Event and ref types stay those of the div form. */
  as?: ActionHostElement;
  /** Opt-in presentation: a flat card-radius row, a framed floating card, or a rectangular compound settings row.
   * Omit to retain the standard control-radius host. Interaction states remain shared. */
  variant?: "row" | "floating" | "settings";
  /** The row, tab or card is the current one; the host paints the selected fill. */
  selected?: boolean;
  /** A compound settings row separates itself from its preceding peer without painting child controls. */
  separator?: boolean;
  /** A row-owned popup is open; retain the interaction slots while the pointer leaves. */
  interactionOpen?: boolean;
  /** Press lifecycle owned by a drag/long-press controller. */
  pressed?: boolean;
  /** An inert compound hover row keeps its child controls' press feedback without implying a whole-row action. */
  pressFeedback?: boolean;
  /** Opt-in interaction ink for the row without changing resting or selected ink. */
  interactionTone?: "primary" | "neutral";
  /** A saved custom resting colour (any CSS colour, may be translucent). The host keeps
   *  it at rest and paints hover, pressed and selected as solid layers above it, so a
   *  custom ground never hides a state. Prefer this over an inline `backgroundColor`. */
  ground?: string;
  /** Inline actions appear only on hover, keyboard focus or an open menu; selection and
   *  pointer focus left by a click do not keep them visible. Touch still always shows them. */
  hoverReveal?: boolean;
  /** Ink of the row's own text, a Text tone. Computed tones are fine (selected, disabled).
   *  It sits below utility classes, so a caller's `group-hover:text-…` or state class still
   *  wins; children that set their own colour (Buttons, Text) keep it. Unset keeps today's ink. */
  tone?: TextTone;
  /** Type size of the row's own text, a Text size. Unset keeps the surrounding size. */
  size?: TextSize;
  /** Density-aware compact row/tab height or fill the bounded parent, independent from typography `size`.
   * Omit for content-sized cards and multi-line rows. */
  controlHeight?: "compact" | "fill";
  /** Density-aware minimum for multi-line rows, independent of the fixed/fill height. */
  controlMinHeight?: "compact" | "control" | "large";
  /** Shared control padding roles; ancestor container layout may override logical inline spacing variables. */
  padding?: ControlPadding;
};

export type ActionHostAppearance = Pick<
  ActionHostProps,
  | "variant"
  | "selected"
  | "separator"
  | "interactionOpen"
  | "pressed"
  | "pressFeedback"
  | "interactionTone"
  | "ground"
  | "hoverReveal"
  | "tone"
  | "size"
  | "controlHeight"
  | "controlMinHeight"
  | "padding"
>;
/**
 * Shared row appearance on an existing element. Undefined retains only its placement class and no interaction host.
 * @group layout
 * @use A compound settings row that must retain its element identity while changing between stacked and interactive layout.
 * @avoid A new row element: ActionHost. Static boxes: Surface.
 */
export function actionHostAttributes(
  appearance: ActionHostAppearance | undefined,
  className?: string,
  style?: CSSProperties,
) {
  if (!appearance) return { className, style };
  const {
    variant,
    selected,
    separator,
    interactionOpen,
    pressed,
    pressFeedback,
    interactionTone,
    ground,
    hoverReveal,
    tone,
    size,
    controlHeight,
    controlMinHeight,
    padding,
  } = appearance;
  return {
    "data-action-host": "",
    "data-variant": variant,
    "data-selected": selected || undefined,
    "data-separator": separator || undefined,
    "data-action-open": interactionOpen || undefined,
    "data-pressed": pressed || undefined,
    "data-press-feedback": pressFeedback === false ? "false" : undefined,
    "data-interaction-tone": interactionTone,
    "data-ground": ground ? "" : undefined,
    "data-hover-reveal": hoverReveal ? "" : undefined,
    "data-tone": tone,
    "data-size": size,
    "data-control-height": controlHeight,
    "data-control-min-height": controlMinHeight,
    style: {
      ...style,
      ...controlPaddingStyle(padding),
      ...(ground ? { "--action-host-ground": ground } : {}),
    } as CSSProperties,
    className: [styles.host, className].filter(Boolean).join(" "),
  };
}

/**
 * A row, tab or card that owns its highlight while holding a primary control and compact inline actions. Hover, focus, press and selection paint on the host, so moving onto an inline action keeps the whole item lit and pressing it never paints the row as pressed.
 * Make the primary Button a direct child (or mark it `data-action-primary`) so it drops its own fills. Feature controllers keep roles, selection and drag.
 * @group layout
 * @use Rail rows, tabs and cards with a main action plus close/remove/more inline actions. Use padding and control height roles to preserve density without control-size classes.
 * @avoid A plain list row with no inline actions: Button variant="item". One standalone icon action: Button iconOnly. Static grouping without actions: Surface.
 */
export function ActionHost({
  as,
  variant,
  selected,
  separator,
  interactionOpen,
  pressed,
  pressFeedback,
  interactionTone,
  ground,
  hoverReveal,
  tone,
  size,
  controlHeight,
  controlMinHeight,
  padding,
  className,
  style,
  ...props
}: ActionHostProps) {
  // The element varies; the props are those of the div form (a ref typed for li or article is a div ref).
  const Element = (as ?? "div") as "div";
  return (
    <Element
      {...props}
      {...actionHostAttributes(
        {
          variant,
          selected,
          separator,
          interactionOpen,
          pressed,
          pressFeedback,
          interactionTone,
          ground,
          hoverReveal,
          tone,
          size,
          controlHeight,
          controlMinHeight,
          padding,
        },
        className,
        style,
      )}
    />
  );
}

export type ActionContentOptions = {
  /** Search result text wraps on selection/touch; previews grow from one to six lines on selection, focus or fine-pointer hover. */
  reveal?: "wrap" | "preview";
  phase: "rest" | "interaction" | "always" | "hover-overlay";
  /** A terminal overlay remains visible while its own controls or popup are open. */
  open?: boolean;
  /** visibility preserves the slot, display frees its width, screen-reader preserves the name; corner reserves an overlaid dismiss target; dim keeps secondary actions at 0.6 opacity until interaction. */
  hide?: "opacity" | "visibility" | "display" | "screen-reader" | "corner" | "dim";
  display?: "block" | "flex" | "inline-flex";
  /** Preview actions may stay revealed after pointer focus enters any descendant. */
  focus?: "within";
  /** Preserve the desktop opacity policy on touch instead of always revealing actions. */
  touch?: "preserve";
  hidden?: boolean;
  interactionTone?: "primary" | "neutral";
};
/**
 * Content in an existing row/control swaps under the same shared interaction rules as its inline actions.
 * @group layout
 * @use An identity mark replaced by row actions, a status label yielding to controls, or a corner dismiss target. Apply to the existing child element.
 * @avoid Action controls themselves: InlineAction. Static visibility unrelated to an interactive owner: feature layout.
 */
export function actionContentAttributes(
  {
    phase,
    reveal,
    hide = "display",
    display = "block",
    focus,
    touch,
    hidden,
    open,
    interactionTone,
  }: ActionContentOptions,
  className?: string,
) {
  return {
    "data-action-content": phase,
    "data-action-reveal": reveal,
    "data-action-hide": hide,
    "data-action-display": display,
    "data-action-focus": focus,
    "data-action-touch": touch,
    "data-action-hidden": hidden || undefined,
    "data-action-open": open || undefined,
    "data-interaction-tone": interactionTone,
    className: [styles.content, className].filter(Boolean).join(" "),
  };
}
export type ActionDragAppearance = {
  /** Sortable item lifted, or a source row faded to 0.4, by its existing data-dragging controller. */
  appearance?: "lifted" | "faded";
  /** Pointer-owned pane drag handle; does not opt into native draggable behavior. */
  grab?: boolean;
  /** Admission and lifecycle stay with the feature's native drag controller. */
  target?: boolean;
  dragging?: boolean;
  before?: boolean;
};
/**
 * Shared drag affordance and accepted-target/reorder cues on an existing row or lane.
 * @group layout
 * @use Native draggable lists and board lanes; the caller keeps all drag handlers and permissions.
 * @avoid Static selected state: ActionHost. Freeform canvas artwork: its renderer.
 */
export function actionDragAttributes(
  { target, dragging, before, appearance, grab }: ActionDragAppearance,
  className?: string,
) {
  return {
    "data-action-drag-appearance": appearance,
    "data-action-grab": grab || undefined,
    "data-action-drop-target": target || undefined,
    "data-action-dragging": dragging || undefined,
    "data-action-drop-before": before || undefined,
    className: [styles.drag, className].filter(Boolean).join(" "),
  };
}

/** @internal A layout-only compound control can own swaps without painting an ActionHost surface. */
export function actionContentScopeAttributes(className?: string) {
  return { "data-action-content-scope": "", className };
}

type InlineActionButtonProps = Omit<
  ButtonProps,
  "iconOnly" | "inset" | "variant" | "label" | "size"
>;

export type InlineActionProps = InlineActionButtonProps & {
  /** Accessible name and tooltip. */
  label: string;
  /** `interaction` (default) shows the action while its host is hovered, focused or
   *  selected; keyboard focus, an open menu and touch input always show it. */
  reveal?: "always" | "interaction";
};

const activationKeys = new Set(["Enter", " ", "Spacebar"]);

/**
 * Compact icon action inside an ActionHost: about 20px, transparent overlay hover/press, secondary ink. Its pointer, click, middle-click, activation keys and drag start never reach the host, so closing a tab does not also select or drag it.
 * @group actions
 * @use Frequent icon actions inside an ActionHost row, tab or card (close, remove, pin).
 * @avoid Outside an ActionHost: Button iconOnly. Rarely used actions: InlineMoreAction. Text action: InlineTextAction.
 */
export function InlineAction({ reveal = "interaction", ...props }: InlineActionProps) {
  return <InlineActionButton {...props} reveal={reveal} inset="icon" iconOnly />;
}

export type InlineMoreActionProps = Omit<
  InlineActionProps,
  "children" | "onClick" | "aria-haspopup" | "aria-expanded"
> & {
  /** Names the object the menu acts on, for example "Actions for server.ts". */
  label: string;
  /** The menu opened from this action is showing. Omit when the caller cannot tell. */
  expanded?: boolean;
  /** Opens the row's own menu at this anchor, with the same target and permissions as its context menu. */
  onOpen: (anchor: HTMLButtonElement) => void;
};

/**
 * The row's overflow entry for secondary actions. It opens the same menu as right-click and the context-menu key, so touch and keyboard users reach the same target.
 * Frequent actions stay direct InlineActions; status (counts, Git state, connection) stays visible in the row, never in this menu.
 * @group actions
 * @use Overflow button of an ActionHost row that opens the row's own ContextMenu.
 * @avoid Frequent actions: InlineAction. A menu detached from a row: DropdownMenu.
 */
export function InlineMoreAction({ expanded, onOpen, reveal, ...props }: InlineMoreActionProps) {
  return (
    <InlineAction
      {...props}
      reveal={reveal}
      aria-haspopup="menu"
      aria-expanded={expanded}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <MoreHorizontal className="icon-sm" strokeWidth={1.75} aria-hidden />
    </InlineAction>
  );
}

export type InlineTextActionProps = Omit<InlineActionButtonProps, "label"> & {
  /** Visible label; also the accessible name unless `aria-label` is given. */
  children: string;
  reveal?: "always" | "interaction";
};

/**
 * Text counterpart of InlineAction: a content-sized 20px caption action ("Undo", "Retry", "Show") inside an ActionHost with the same overlay states, reveal rules and event isolation.
 * @group actions
 * @use Short text action inside an ActionHost row or card.
 * @avoid Outside an ActionHost: Button variant="ghost". Icon-only action: InlineAction.
 */
export function InlineTextAction({ reveal = "always", children, ...props }: InlineTextActionProps) {
  return (
    <InlineActionButton {...props} reveal={reveal} inset="text" iconOnly={false}>
      {children}
    </InlineActionButton>
  );
}

function InlineActionButton({
  reveal,
  inset,
  iconOnly,
  onClick,
  onPointerDown,
  onMouseDown,
  onAuxClick,
  onKeyDown,
  onDragStart,
  ...props
}: InlineActionButtonProps & {
  reveal: "always" | "interaction";
  inset: "icon" | "text";
  iconOnly: boolean;
  label?: string;
}) {
  return (
    <Button
      {...({ ...props, iconOnly } as ButtonProps)}
      variant="ghost"
      size="sm"
      inset={inset}
      data-action-inline=""
      data-action-reveal={reveal === "interaction" ? "" : undefined}
      draggable={false}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onPointerDown?.(event);
      }}
      onMouseDown={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onMouseDown?.(event);
      }}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      onAuxClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onAuxClick?.(event);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        if (activationKeys.has(event.key)) event.stopPropagation();
        onKeyDown?.(event);
      }}
      onDragStart={(event: DragEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onDragStart?.(event);
      }}
    />
  );
}
