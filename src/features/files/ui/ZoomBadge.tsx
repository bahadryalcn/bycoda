import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/technical";
import { formatZoomPercent } from "./documentZoom";

/** Floating zoom readout for viewers without a toolbar; click to reset. */
export function ZoomBadge({ zoom, onReset }: { zoom: number; onReset: () => void }) {
  useLocale();
  if (zoom === 1) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      motion="none"
      type="button"
      title={t("Reset zoom")}
      aria-label={t("Zoom {p0}, reset to 100%", { p0: formatZoomPercent(zoom) })}
      onClick={onReset}
      className="absolute bottom-3 right-4 z-30 tabular-nums"
    >
      {formatZoomPercent(zoom)}
    </Button>
  );
}
