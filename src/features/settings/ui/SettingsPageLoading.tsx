import { useT } from "../../../shared/i18n";
import { Skeleton } from "../../../shared/ui/Skeleton";
import "./SettingsLoadingSurface.css";

/**
 * The one in-page loading placeholder for a Settings page or section whose first data is still
 * on its way. It reserves roughly the loaded height (`lines`) so the page does not jump, hides
 * itself for the shared loading delay so warm data never flashes it, and announces one polite status. Use it
 * instead of an empty state, a one-line spinner or nothing.
 */
export function SettingsPageLoading({ label, lines = 6 }: { label?: string; lines?: number }) {
  const t = useT();
  return (
    <div className="settings-page-loading" data-settings-page-loading>
      <Skeleton label={label ?? t("Loading…")} lines={lines} />
    </div>
  );
}
