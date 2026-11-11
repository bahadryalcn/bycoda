import { useId, useRef, useState, type ReactNode } from "react";
import { useCopyFeedback } from "../hooks/useCopyFeedback";
import { useT } from "../i18n";
import { truncateGraphemes } from "../lib/text/truncate";
import { Button } from "./Button";
import { InlineError, type InlineErrorProps } from "./InlineError";
import { Popover } from "./Popover";

/**
 * "Details" link that opens a dialog Popover with the complete technical error text (selectable,
 * scrollable, copyable) and optional recovery `actions`. The hosting banner, toolbar or row keeps
 * its height: raw command or transport output never lands in the layout.
 * @group feedback
 * @use The raw error text behind a short, plain failure message in an Alert, InlineError, banner or row.
 * @avoid Failed pane or route: FailureState (it owns its details). Help that is not an error: InfoPopover. An error short enough for its line: show it directly.
 *
 * ```tsx
 * <Alert tone="danger" title={title} action={<ErrorDetails title={title} detail={error} />} />
 * ```
 */
export function ErrorDetails({
  detail,
  title,
  label,
  actions,
  children,
  width = 420,
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
  const copy = useCopyFeedback({ resetKeys: [detail] });
  const text = label ?? t("Details");
  const name = title ? `${text}: ${title}` : text;
  const close = () => setOpen(false);
  return (
    <>
      <Button
        ref={anchor}
        type="button"
        variant="link"
        className={className}
        aria-label={name}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? contentId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {text}
      </Button>
      {open ? (
        <Popover
          id={contentId}
          anchor={anchor}
          width={width}
          kind="dialog"
          aria-label={name}
          tabIndex={-1}
          flow="scroll"
          onDismiss={close}
          className="flex flex-col gap-2 p-3 text-ui-secondary text-(--ui-text-secondary)"
        >
          {children}
          <pre
            aria-label={t("Error details")}
            className="m-0 min-w-0 font-mono text-ui-caption wrap-anywhere whitespace-pre-wrap text-content select-text"
          >
            {detail}
          </pre>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={copy.pending}
              onClick={() => copy.copy(() => navigator.clipboard.writeText(detail))}
            >
              {copy.copied ? t("Copied") : t("Copy details")}
            </Button>
            {actions?.(close)}
          </div>
          {copy.failed ? <InlineError>{copy.error}</InlineError> : null}
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

export type DetailedInlineErrorProps = Omit<InlineErrorProps, "children"> & {
  /** Raw backend, command or transport text. */
  error: string;
  /** Plain sentence shown instead of the raw text, which then always sits behind Details. */
  summary?: string;
};

/**
 * InlineError for raw backend, command or transport text. Text that fits one short line is shown as
 * written; anything longer or multi-line shows `summary` (or its first line, shortened) with an
 * ErrorDetails link, so a toolbar, row or rail never grows or clips the message.
 * @group feedback
 * @use A row, toolbar, rail or form failure whose text comes from a command, the Host or a remote machine.
 * @avoid Copy the app wrote itself (validation, fixed sentences): InlineError. Titled notice: Alert with ErrorDetails as its action. Failed pane: FailureState.
 *
 * ```tsx
 * {error ? <DetailedInlineError summary={t("Could not load.")} error={error} retry={{ onRetry }} /> : null}
 * ```
 */
export function DetailedInlineError({
  error,
  summary,
  action,
  ...props
}: DetailedInlineErrorProps) {
  if (!summary && fitsOneLine(error)) {
    return (
      <InlineError {...props} action={action}>
        {error}
      </InlineError>
    );
  }
  const headline = summary ?? errorHeadline(error);
  return (
    <InlineError
      {...props}
      action={
        <>
          {error && error !== summary ? <ErrorDetails title={headline} detail={error} /> : null}
          {action ? <> {action}</> : null}
        </>
      }
    >
      {headline}
    </InlineError>
  );
}
