import { useT } from "../../../shared/i18n";
import { useDelayedVisible } from "../../../shared/hooks/useDelayedVisible";
import { SettingsGroupsSkeleton } from "./SettingsSkeleton";
import "./SettingsLoadingSurface.css";

/**
 * The one in-page loading placeholder for a Settings page or section whose first data is still
 * on its way. It mirrors the page's framed topic rows (`lines` rows) so the page does not jump,
 * hides itself for the shared loading delay so warm data never flashes it, and announces one
 * polite status. Use it instead of an empty state, a one-line spinner or nothing.
 */
export function SettingsPageLoading({ label, lines = 6 }: { label?: string; lines?: number }) {
  const t = useT();
  const visible = useDelayedVisible(true);
  return (
    <div
      className="settings-page-loading"
      data-settings-page-loading
      data-held={visible ? undefined : "true"}
      role={visible ? "status" : undefined}
      aria-label={visible ? (label ?? t("Loading…")) : undefined}
      aria-busy="true"
    >
      <SettingsGroupsSkeleton rows={lines} />
    </div>
  );
}
