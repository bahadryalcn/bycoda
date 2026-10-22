import { Alert as ArcAlert, type AlertProps } from "./arc/alert/alert";

export type { AlertProps, AlertTone } from "./arc/alert/alert";

/** Inline foreground feedback; operation state and recovery stay with the caller. */
export function Alert({ className, ...props }: AlertProps) {
  return <ArcAlert {...props} className={["bycoda-arc", className].filter(Boolean).join(" ")} />;
}
