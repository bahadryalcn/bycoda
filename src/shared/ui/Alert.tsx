import { useT } from "../i18n";
import { Alert as ArcAlert, type AlertProps } from "./arc/alert/alert";

export type { AlertProps, AlertTone } from "./arc/alert/alert";

/**
 * Thin tinted strip (no border) with a toned glyph, optional 500 title, body, structured `action` / `secondaryAction` as text links at the end, and optional dismiss. Danger announces assertively (`role="alert"`), other tones politely (`role="status"`); the glyph carries the tone, the copy stays neutral. Operation state and recovery stay with the caller.
 * It stays in the page flow; a notice that floats in a corner is Toast.
 * Hand-written persistent notice banners. Inline feedback uses InlineError / InlineMessage.
 * @group feedback
 * @use A persistent, titled message about the current view or form that may carry a recovery action.
 * @avoid One-line field or row error: InlineError / InlineMessage (the retired `inline` prop). Timed or floating confirmation: Toast. Failed region load: FailureState. Never a Button in `action`; a non-button control goes in `extra`.
 * @action Pass `action={{ label, onClick }}` (+ `secondaryAction`); the component renders text-link buttons.
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
