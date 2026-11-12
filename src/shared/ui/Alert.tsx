import { useT } from "../i18n";
import { Alert as ArcAlert, type AlertProps } from "./arc/alert/alert";

export type { AlertProps, AlertTone } from "./arc/alert/alert";

/**
 * Boxed inline notice with tone glyph, optional title, body, `action` and dismiss. Danger announces assertively (`role="alert"`), other tones politely (`role="status"`); glyph and text carry meaning, not colour. Operation state and recovery stay with the caller.
 * It stays in the page flow; a notice that floats in a corner is Toast or TransientNotice.
 * Legacy `inline` calls render through InlineMessage with the same glyph, typography and spacing.
 * Hand-written persistent notice banners. Inline feedback uses InlineError / InlineMessage.
 * @group feedback
 * @use A persistent, titled message about the current view or form that may carry a recovery action.
 * @avoid One-line field or row error: InlineError / InlineMessage. Timed or floating confirmation: Toast or TransientNotice. Failed region load: FailureState.
 * @arc alert
 */
export function Alert({ className, dismissLabel, ...props }: AlertProps) {
  const t = useT();
  return (
    <ArcAlert
      {...props}
      dismissLabel={
        dismissLabel ?? (props.title ? `${t("Dismiss")}: ${props.title}` : t("Dismiss"))
      }
      className={["bycoda-arc", className].filter(Boolean).join(" ")}
    />
  );
}
