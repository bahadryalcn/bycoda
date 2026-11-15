import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { optionalTextAttributes, type TextRoles } from "./Text";
import { useT } from "../i18n";
import { ErrorDetails, errorHeadline, fitsOneLine } from "./ErrorDetails";
import { NoticeGlyph, NoticeLink, type NoticeAction, type NoticeTone } from "./Notice";

export type InlineMessageTone = NoticeTone;

export type InlineMessageProps = Omit<ComponentPropsWithoutRef<"div">, "role" | "children"> & {
  tone?: InlineMessageTone;
  /** Copy typography; unset preserves hierarchy and semantic ink. */
  text?: TextRoles;
  children: ReactNode;
  /**
   * How a change is announced. `assertive` renders `role="alert"` (default for danger), `polite`
   * renders `role="status"` (default for the other tones), `off` renders no live role, for a
   * message that is present when its surface opens and must not interrupt.
   */
  live?: "assertive" | "polite" | "off";
  /** Replaces the tone glyph. `null` drops it; the tone alone never carries meaning, so keep the copy explicit. */
  icon?: ReactNode | null;
  /** Retry recovery. The caller owns the operation; `pending` shows progress and blocks a second press. */
  retry?: { onRetry: () => void; label?: string; pending?: boolean; disabled?: boolean };
  /** One follow-up (an "Open settings" link) rendered as a text link after the copy. Prefer `retry` for a plain retry. */
  action?: NoticeAction;
  /** A second follow-up (Dismiss, Discard) rendered after `action`. */
  secondaryAction?: NoticeAction;
  /** Escape for one non-button control that must sit after the copy (a Details popover trigger). Text height only. */
  extra?: ReactNode;
};

/** Neutral copy for every tone; only a danger sentence may tint (InlineError). */
const INK: Record<InlineMessageTone, string> = {
  danger: "text-(--ui-tone-danger-fg)",
  warning: "text-(--ui-text-secondary)",
  info: "text-(--ui-text-secondary)",
  success: "text-(--ui-text-secondary)",
  neutral: "text-(--ui-text-secondary)",
};

/**
 * One-line field, row or form message: neutral caption copy, a toned 14px glyph centred on the first
 * line, and structured `retry`, `action` and `secondaryAction` text links after the copy. `live` picks
 * `role="alert"` (danger default), `status` (other tones) or none.
 * @group feedback
 * @use A short success, warning, info or neutral note under a field, in a row or in a form.
 * @avoid Failures: InlineError. Boxed notice with a title: Alert. Nothing to show: EmptyState. Region that failed to load: FailureState. Never a bare `<p role="alert">`; never a Button in `action`.
 * @action Pass `action={{ label, onClick }}`; the component renders the link at caption height.
 */
export function InlineMessage({
  tone = "info",
  text,
  live,
  icon,
  retry,
  action,
  secondaryAction,
  extra,
  children,
  className,
  ...props
}: InlineMessageProps) {
  const t = useT();
  const mode = live ?? (tone === "danger" ? "assertive" : "polite");
  return (
    <div
      {...props}
      role={mode === "assertive" ? "alert" : mode === "polite" ? "status" : undefined}
      data-tone={tone}
      className={[
        "flex min-w-0 items-start gap-1.5 font-sans text-ui-caption",
        INK[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <NoticeGlyph tone={tone} size="inline" icon={icon} />
      {/* Recovery follows the copy on its line and wraps with it, never detached at the far edge. */}
      <span {...optionalTextAttributes(text ?? {}, "min-w-0 flex-1 break-words")}>
        <span className="select-text">{children}</span>
        {extra ? <> {extra}</> : null}
        {action ? (
          <>
            {" "}
            <NoticeLink action={action} />
          </>
        ) : null}
        {secondaryAction ? (
          <>
            {" "}
            <NoticeLink action={secondaryAction} />
          </>
        ) : null}
        {retry ? (
          <>
            {" "}
            <NoticeLink
              action={{
                label: retry.label ?? t("Retry"),
                onClick: retry.onRetry,
                pending: retry.pending,
                disabled: retry.disabled,
              }}
            />
          </>
        ) : null}
      </span>
    </div>
  );
}

export type InlineErrorProps = Omit<InlineMessageProps, "tone" | "children"> & {
  /** The visible sentence. Optional when `details` carries the raw text. */
  children?: ReactNode;
  /**
   * Raw backend, command or transport text. Without `children`, text that fits one short line shows as
   * written and anything longer or multi-line shows its first line with a Details link. With `children`,
   * the raw text always sits behind Details.
   */
  details?: string;
};

/**
 * The one inline error: danger ink, caption size, a toned alert glyph and `role="alert"` (pass
 * `live="polite"` or `"off"` for an error already present on open). Structured `retry`, `action` and
 * `secondaryAction` render as text links after the copy. `details` takes raw command or transport
 * output: it shows as written when short, otherwise behind a Details link, so a row never grows or clips.
 * @group feedback
 * @use A failure under a field, in a row or in a form; raw Host, command or remote text via `details`.
 * @avoid Non-error tones: InlineMessage. Boxed notice with a title: Alert (with `extra` ErrorDetails). Region that failed to load: FailureState. Never a bare `<p role="alert">`.
 * @action Pass `action={{ label, onClick }}` or `retry`; never a Button.
 *
 * ```tsx
 * {error ? <InlineError details={error} retry={{ onRetry: reload, pending: loading }}>{t("Could not load.")}</InlineError> : null}
 * ```
 */
export function InlineError({ details, children, extra, ...props }: InlineErrorProps) {
  const hasSummary = children !== undefined && children !== null && children !== false;
  if (details === undefined || (!hasSummary && fitsOneLine(details))) {
    return (
      <InlineMessage {...props} tone="danger" extra={extra}>
        {hasSummary ? children : details}
      </InlineMessage>
    );
  }
  const headline = hasSummary ? children : errorHeadline(details);
  return (
    <InlineMessage
      {...props}
      tone="danger"
      extra={
        <>
          {details && details !== headline ? (
            <ErrorDetails
              title={typeof headline === "string" ? headline : undefined}
              detail={details}
            />
          ) : null}
          {extra ? <> {extra}</> : null}
        </>
      }
    >
      {headline}
    </InlineMessage>
  );
}
