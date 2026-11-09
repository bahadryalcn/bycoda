import { useDelayedVisible } from "../hooks/useDelayedVisible";
import { useT } from "../i18n";
import { Progress } from "./Progress";
import styles from "./SurfaceLoading.module.css";

/**
 * First-load placeholder for a lazily loaded region (an editor or media pane). Indeterminate by
 * design: the amount of work is unknown, so it never shows a percentage. It keeps the region's box
 * but stays invisible for the first moments (`LOADING_DELAY_MS`), so a warm chunk never flashes it.
 * Short operations use the initiating control's own pending state instead.
 * @group feedback
 * @use Placeholder while a lazily loaded pane (editor, media, large view) loads for the first time.
 * @avoid Known-shape content loading: Skeleton. Short action pending: the control's own pending state. Measurable progress: Progress.
 */
export function SurfaceLoading({ label }: { label?: string }) {
  const t = useT();
  const visible = useDelayedVisible(true);
  return (
    <div className={styles.root} data-pending={visible ? undefined : "true"} aria-busy="true">
      {visible ? <Progress label={label ?? t("Loading…")} compact /> : null}
    </div>
  );
}
