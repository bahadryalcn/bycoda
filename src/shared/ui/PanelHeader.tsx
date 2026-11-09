import type { ReactNode, Ref } from "react";
import { Button } from "./Button";
import { X } from "./icons";

export type PanelHeaderProps = {
  title: string;
  /** Id for the title element, so the surface can name itself with `aria-labelledby`. */
  titleId?: string;
  /** Typographic role: `compact` (title role) for panes and small dialogs, `task` (heading role) for bounded tasks. */
  level?: "compact" | "task";
  /** Optional context above the title, such as the project or object the surface acts on. */
  context?: ReactNode;
  description?: string;
  descriptionId?: string;
  /** Renders the 28px ghost close action when provided. */
  onClose?: () => void;
  closeLabel?: string;
  closeRef?: Ref<HTMLButtonElement>;
  /** Extra trailing actions placed before the close action (28px ghost icon Buttons). */
  actions?: ReactNode;
  /** Keeps the text for assistive tech only, so focused content owns the visual hierarchy. */
  textOnlyForAssistiveTech?: boolean;
  className?: string;
};

const TITLE: Record<"compact" | "task", string> = {
  compact: "text-ui-title font-medium text-content",
  task: "text-ui-heading font-medium text-content",
};

/**
 * Header of a Modal, end Sheet or popover panel: optional context line, h2 title, description, trailing actions
 * and a 28px ghost close. Long titles wrap; `textOnlyForAssistiveTech` keeps the name screen-reader only.
 * Modal and Sheet render it for you; use it directly only when composing your own panel.
 * @group layout
 * @use Name and close a dialog, sheet or popover panel (`level="task"` for bounded tasks).
 * @avoid Pane or tool title row: PaneHeader. Group caption inside content: SectionLabel. Prefer Modal/Sheet `title` over rendering this by hand.
 */
export function PanelHeader({
  title,
  titleId,
  level = "compact",
  context,
  description,
  descriptionId,
  onClose,
  closeLabel = "Close",
  closeRef,
  actions,
  textOnlyForAssistiveTech = false,
  className,
}: PanelHeaderProps) {
  return (
    <header className={["flex shrink-0 items-start gap-2", className].filter(Boolean).join(" ")}>
      <div className={textOnlyForAssistiveTech ? "sr-only" : "min-w-0 flex-1 pt-0.5"}>
        {context ? (
          <div className="ui-secondary-text mb-0.5 truncate text-ui-caption">{context}</div>
        ) : null}
        <h2 id={titleId} className={[TITLE[level], "break-words"].join(" ")}>
          {title}
        </h2>
        {description ? (
          <p id={descriptionId} className="ui-secondary-text mt-0.5 break-words leading-snug">
            {description}
          </p>
        ) : null}
      </div>
      {actions}
      {onClose ? (
        <Button
          ref={closeRef}
          type="button"
          iconOnly
          size="sm"
          label={closeLabel}
          tooltip={closeLabel}
          variant="ghost"
          onClick={onClose}
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </Button>
      ) : null}
    </header>
  );
}
