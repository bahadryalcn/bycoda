import type { MouseEvent, ReactNode } from "react";
import { copyText } from "../../platform/tauri/clipboard";
import { useCopyFeedback } from "../hooks/useCopyFeedback";
import { useT } from "../i18n";
import { Button, type ButtonProps } from "./Button";
import { AlertCircle, Check, Copy } from "./icons";
import { InlineError } from "./InlineError";
import { LiveText } from "./LiveText";

type CopyButtonProps = Omit<
  ButtonProps,
  "iconOnly" | "label" | "children" | "value" | "loading" | "success" | "successLabel"
> & {
  /** Translated idle label: visible text, or the accessible name and tooltip when `iconOnly`. */
  label: string;
  /** Text to copy, read at click time when a function. */
  text?: string | (() => string);
  /** Custom clipboard write (rich message, file, lazily loaded content). Wins over `text`. */
  onCopy?: () => Promise<unknown>;
  iconOnly?: boolean;
  /** Idle icon; defaults to the copy glyph. */
  icon?: ReactNode;
  /** Translated confirmation; defaults to "Copied". */
  copiedLabel?: string;
  /** Content identity: a change clears a shown outcome (see `useCopyFeedback`). */
  resetKeys?: readonly unknown[];
  /** Called with the failure after the visible failed state is set, for callers that log it. */
  onCopyError?: (error: unknown) => void;
  /** Show a compact inline failure beside the retryable copy button, with diagnostics on demand. */
  errorDetail?: boolean;
};

/**
 * Copy action with confirmed feedback: the copy glyph turns into a success check (text buttons
 * show "Copied") for two seconds after the clipboard write settles, a failure stays visible with
 * a retry label until the next press, and both are announced. The size never changes.
 * @group actions
 * @use Any button whose job is copying text, a path, a command or a message to the clipboard.
 * @avoid Copy entries inside a ContextMenu or DropdownMenu (the menu closes): keep the menu item and report through its owner. A button that also does something else: Button with `useCopyFeedback`.
 */
export function CopyButton({
  label,
  text,
  onCopy,
  iconOnly = false,
  icon,
  copiedLabel,
  resetKeys,
  onCopyError,
  errorDetail = false,
  onClick,
  variant = iconOnly ? "ghost" : "secondary",
  tooltip,
  className,
  ...props
}: CopyButtonProps) {
  const t = useT();
  const feedback = useCopyFeedback({ resetKeys });
  const done = copiedLabel ?? t("Copied");
  const failedLabel = t("Copy failed. Try again.");
  const run = (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    const write = async () =>
      onCopy ? onCopy() : copyText(typeof text === "function" ? text() : (text ?? ""));
    feedback.copy(() =>
      write().catch((error: unknown) => {
        onCopyError?.(error);
        throw error;
      }),
    );
  };
  const state = feedback.copied ? "copied" : feedback.failed ? "failed" : undefined;
  const showInlineFailure = feedback.failed && errorDetail;
  const showButtonFailure = feedback.failed && !errorDetail;
  const name = showButtonFailure ? failedLabel : feedback.copied ? done : label;
  // A failure detail is an alert of its own; otherwise only a shown outcome mounts a live region,
  // so an idle button never adds an empty status next to its neighbours' messages.
  const announcement = showInlineFailure ? (
    <InlineError className="max-w-xs" details={feedback.error}>
      {failedLabel}
    </InlineError>
  ) : state && (iconOnly || feedback.failed) ? (
    <LiveText className="sr-only" text={name} />
  ) : null;
  if (iconOnly) {
    return (
      <>
        <Button
          {...props}
          iconOnly
          variant={variant}
          label={name}
          tooltip={tooltip && !state ? tooltip : name}
          className={className}
          data-copy-state={state}
          aria-busy={feedback.pending || undefined}
          onClick={run}
        >
          {feedback.copied ? (
            <Check tone="success" className="icon-sm" aria-hidden="true" />
          ) : showButtonFailure ? (
            <AlertCircle tone="danger" className="icon-sm" aria-hidden="true" />
          ) : (
            (icon ?? <Copy className="icon-sm" aria-hidden="true" />)
          )}
        </Button>
        {announcement}
      </>
    );
  }
  // The Button announces success itself; a failure gets its own live region outside the label.
  return (
    <>
      <Button
        {...props}
        variant={variant}
        tooltip={tooltip}
        className={className}
        aria-label={name}
        data-copy-state={state}
        loading={feedback.pending}
        success={feedback.copied}
        successLabel={done}
        reserveLabels={errorDetail ? undefined : [failedLabel]}
        startIcon={
          showButtonFailure ? (
            <AlertCircle tone="danger" className="icon-sm" />
          ) : (
            (icon ?? <Copy className="icon-sm" />)
          )
        }
        onClick={run}
      >
        {showButtonFailure ? failedLabel : label}
      </Button>
      {announcement}
    </>
  );
}
