import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useT } from "../i18n";
import { Button } from "./Button";
import { AlertCircle, Check, CircleX, Info } from "./icons";

export type InlineMessageTone = "danger" | "warning" | "info" | "success" | "neutral";

export type InlineMessageProps = Omit<ComponentPropsWithoutRef<"div">, "role" | "children"> & {
  tone?: InlineMessageTone;
  children: ReactNode;
  /**
   * How a change is announced. `assertive` renders `role="alert"` (default for danger), `polite`
   * renders `role="status"` (default for the other tones), `off` renders no live role, for a
   * message that is present when its surface opens and must not interrupt.
   */
  live?: "assertive" | "polite" | "off";
  /** Replaces the tone glyph. `null` drops it; the tone colour alone never carries meaning, so keep the copy explicit. */
  icon?: ReactNode | null;
  /** Retry recovery. The caller owns the operation; `pending` shows progress and blocks a second press. */
  retry?: { onRetry: () => void; label?: string; pending?: boolean; disabled?: boolean };
  /** Another recovery control (an "Open settings" link). Prefer `retry` for a plain retry. */
  action?: ReactNode;
};

const INK: Record<InlineMessageTone, string> = {
  danger: "text-(--ui-tone-danger-fg)",
  warning: "text-(--ui-tone-warning-fg)",
  info: "text-(--ui-tone-info-fg)",
  success: "text-(--ui-tone-success-fg)",
  neutral: "text-(--ui-text-secondary)",
};

/** Same glyph per tone as Alert, so danger and warning never differ by colour alone. */
const GLYPH = {
  danger: CircleX,
  warning: AlertCircle,
  info: Info,
  success: Check,
  neutral: Info,
} as const;

/**
 * One-line field, row or form message: tone ink, caption size, a tone glyph (not colour alone), optional `retry`
 * link or `action` after the copy. `live` picks `role="alert"` (danger default), `status` (other tones) or none.
 * @group feedback
 * @use A short success, warning, info or neutral note under a field, in a row or in a form.
 * @avoid Failures: InlineError. Boxed notice with a title: Alert. Nothing to show: EmptyState. Region that failed to load: FailureState. Never a bare `<p role="alert">`.
 */
export function InlineMessage({
  tone = "info",
  live,
  icon,
  retry,
  action,
  children,
  className,
  ...props
}: InlineMessageProps) {
  const t = useT();
  const mode = live ?? (tone === "danger" ? "assertive" : "polite");
  const Glyph = GLYPH[tone];
  const glyph = icon === undefined ? <Glyph className="icon-xs" aria-hidden /> : icon;
  return (
    <div
      {...props}
      role={mode === "assertive" ? "alert" : mode === "polite" ? "status" : undefined}
      data-tone={tone}
      className={["flex min-w-0 items-start gap-1.5 text-ui-caption", INK[tone], className]
        .filter(Boolean)
        .join(" ")}
    >
      {glyph ? (
        // One caption line tall, so the glyph centres on the first line of wrapped copy.
        <span aria-hidden className="flex h-(--ui-leading-caption) shrink-0 items-center">
          {glyph}
        </span>
      ) : null}
      {/* Recovery follows the copy on its line and wraps with it, never detached at the far edge. */}
      <span className="min-w-0 flex-1 break-words">
        <span className="select-text">{children}</span>
        {action ? <> {action}</> : null}
        {retry ? (
          <>
            {" "}
            <Button
              variant="link"
              layout="text"
              loading={retry.pending ?? false}
              disabled={retry.disabled}
              onClick={retry.onRetry}
            >
              {retry.label ?? t("Retry")}
            </Button>
          </>
        ) : null}
      </span>
    </div>
  );
}

export type InlineErrorProps = Omit<InlineMessageProps, "tone">;

/**
 * The one inline error: `--ui-tone-danger-fg`, `text-ui-caption`, a leading alert glyph and
 * `role="alert"` (pass `live="polite"` or `"off"` for an error already present on open).
 * Optional `retry` renders a link-style Retry after the copy.
 * @group feedback
 * @use A failure under a field, in a row or in a form.
 * @avoid Non-error tones: InlineMessage. Boxed notice with a title: Alert. Region that failed to load: FailureState. Never a bare `<p role="alert">`.
 *
 * ```tsx
 * {error ? <InlineError retry={{ onRetry: reload, pending: loading }}>{error}</InlineError> : null}
 * ```
 */
export function InlineError(props: InlineErrorProps) {
  return <InlineMessage {...props} tone="danger" />;
}
