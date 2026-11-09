import { useEffect, useRef } from "react";
import { appName } from "../../../shared/lib/appName";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { TransientNotice } from "../../../shared/ui/TransientNotice";

/**
 * The one-time welcome offer for the first-run tour. It is a quiet corner notice, never a modal:
 * the host only shows it while no dialog (Quick setup included) is open, and it does not take
 * focus from a field the user is typing in. "Later" (or the close button) ends the offer for
 * good; the tour stays one click away in the Guide, the View menu and Settings.
 */
export function TourOffer({ onStart, onLater }: { onStart: () => void; onLater: () => void }) {
  useLocale();
  const actions = useRef<HTMLDivElement>(null);
  // With nothing focused, put the main action in reach of the keyboard.
  useEffect(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    actions.current?.querySelector<HTMLElement>("[data-tour-offer-start]")?.focus();
  }, []);
  return (
    <TransientNotice
      tone="info"
      title={t("Welcome to {p0}", { p0: appName() })}
      message={t(
        "New here? A one-minute tour shows where everything is. You can start it later from the Guide.",
      )}
      aria-label={t("Welcome tour")}
      durationMs={null}
      onDismiss={onLater}
    >
      <div ref={actions} className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onLater}>
          {t("Later")}
        </Button>
        <Button variant="primary" size="sm" data-tour-offer-start onClick={onStart}>
          {t("Take a 1-minute tour")}
        </Button>
      </div>
    </TransientNotice>
  );
}
