import { useId, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { truncateGraphemes } from "../lib/text/truncate";
import { Button } from "./Button";
import { CopyButton } from "./CopyButton";
import { ChevronDown } from "./icons";
import { OutputBlock } from "./OutputBlock";
import { Popover } from "./Popover";
import { Text } from "./Text";

/**
 * "Details" link that opens a dialog Popover with the complete technical error text (selectable,
 * scrollable, copyable) and optional recovery `actions`. The hosting banner, toolbar or row keeps
 * its height: raw command or transport output never lands in the layout.
 * @group feedback
 * @use The raw error text behind a short, plain failure message in an Alert, banner or row. InlineError renders it for you through `details`.
 * @avoid Failed pane or route: FailureState (it owns its details). Help that is not an error: InfoPopover. An error short enough for its line: show it directly.
 *
 * ```tsx
 * <Alert tone="danger" title={title} extra={<ErrorDetails title={title} detail={error} />} />
 * ```
 */
export function ErrorDetails({
  detail,
  title,
  label,
  actions,
  children,
  width = 360,
  className,
}: {
  /** The complete technical text. Shown as written and copied in full. */
  detail: string;
  /** The visible failure this explains; names the trigger and the dialog for assistive tech. */
  title?: string;
  /** Trigger text. Defaults to "Details". */
  label?: string;
  /** Recovery controls shown under the text. Call `close` when one opens another surface. */
  actions?: (close: () => void) => ReactNode;
  /** Plain explanation shown above the technical text. */
  children?: ReactNode;
  width?: number;
  /** Layout hook for the trigger only (e.g. `shrink-0`). */
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const contentId = useId();
  const text = label ?? t("Details");
  const name = title ? `${text}: ${title}` : text;
  const close = () => setOpen(false);
  return (
    <>
      <Button
        ref={anchor}
        type="button"
        variant="link"
        layout="text"
        textSize="caption"
        className={className}
        aria-label={name}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? contentId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {text}
        <ChevronDown className="ms-0.5 inline size-3 align-middle" aria-hidden="true" />
      </Button>
      {open ? (
        <Popover
          id={contentId}
          anchor={anchor}
          width={width}
          maxHeight={320}
          align="end"
          kind="dialog"
          aria-label={name}
          tabIndex={-1}
          flow="scroll"
          solid
          onDismiss={close}
          variant="panel"
          className="flex flex-col gap-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-2">
            <Text size="secondary" tone="primary" weight="medium">
              {t("Technical details")}
            </Text>
            <CopyButton
              type="button"
              variant="ghost"
              size="sm"
              label={t("Copy details")}
              resetKeys={[detail]}
              onCopy={() => navigator.clipboard.writeText(detail)}
            />
          </div>
          {children}
          <OutputBlock aria-label={t("Error details")} frame="filled" className="shrink-0">
            {detail}
          </OutputBlock>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2">{actions(close)}</div>
          ) : null}
        </Popover>
      ) : null}
    </>
  );
}

/** Longest raw error shown whole in a row; anything longer or multi-line goes behind Details. */
export const ERROR_HEADLINE_CHARS = 120;

/** Whether raw error text fits one short line, so it can be shown as written. */
export function fitsOneLine(error: string): boolean {
  return error.length <= ERROR_HEADLINE_CHARS && !/[\r\n]/.test(error);
}

/** First line of raw error text, shortened to fit one row. */
export function errorHeadline(error: string): string {
  return truncateGraphemes(error.trimStart().split(/[\r\n]/, 1)[0], ERROR_HEADLINE_CHARS);
}
