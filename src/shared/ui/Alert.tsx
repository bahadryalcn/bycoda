import { useT } from "../i18n";
import { Alert as ArcAlert, type AlertProps } from "./arc/alert/alert";

export type { AlertProps, AlertTone } from "./arc/alert/alert";

/**
 * Inline foreground feedback; operation state and recovery stay with the caller.
 * Danger announces assertively (`role="alert"`), other tones politely
 * (`role="status"`). Pair a tone with copy: the glyph and text carry the meaning,
 * not the colour. Pass recovery controls through `action`.
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
