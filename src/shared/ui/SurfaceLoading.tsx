import { useT } from "../i18n";
import { Progress } from "./Progress";
import styles from "./SurfaceLoading.module.css";

/**
 * First-load placeholder for a lazily loaded region (an editor or media pane). Indeterminate by
 * design: the amount of work is unknown, so it never shows a percentage. Short operations use the
 * initiating control's own pending state instead.
 */
export function SurfaceLoading({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className={styles.root}>
      <Progress label={label ?? t("Loading…")} compact />
    </div>
  );
}
