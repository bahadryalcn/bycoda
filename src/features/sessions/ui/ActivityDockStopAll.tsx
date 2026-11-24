import { useEffect, useState, type MouseEvent } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { OctagonX } from "../../../shared/ui/icons";
import { LiveText } from "../../../shared/ui/LiveText";
import type { StopAllControl } from "../model/backgroundStop";

/** How long the armed button waits for its second press. */
export const STOP_ALL_CONFIRM_MS = 4_000;

/**
 * The dock header's stop-everything action. It ends work that cannot be resumed
 * and sits beside the list toggle, so the first press only asks for confirmation.
 */
export function DockStopAll({
  control,
  stopping,
  failed,
  onStop,
}: {
  control: StopAllControl;
  stopping: boolean;
  failed: boolean;
  onStop: () => void;
}) {
  const t = useT();
  const [armed, setArmed] = useState(false);

  // Returns an unanswered confirmation to rest, so a later stray press cannot stop the work.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- holds the browser timer while the confirmation is armed.
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), STOP_ALL_CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const press = (event: MouseEvent<HTMLButtonElement>) => {
    // A retry repeats a stop the user already confirmed.
    if (failed) {
      onStop();
      return;
    }
    if (!armed) {
      setArmed(true);
      return;
    }
    // The tail of a double click is not a confirmation.
    if (event.detail > 1) return;
    setArmed(false);
    onStop();
  };

  const text = stopping
    ? t("Stopping…")
    : failed
      ? t("Retry stop")
      : armed
        ? control.confirmLabel
        : t("Stop all");

  return (
    <>
      {/* The name of a focused button can change without being read out. */}
      <LiveText className="sr-only" text={armed ? control.confirmLabel : ""} />
      <Button
        data-dock-stop-all=""
        className="shrink-0"
        variant="secondary"
        tone={armed ? "danger" : "warning"}
        type="button"
        // At rest the short text stands for the control's full name.
        label={text === t("Stop all") && text !== control.label ? control.label : undefined}
        tooltip={failed ? t("Could not stop it. Try again.") : control.title}
        startIcon={<OctagonX className="icon-xs" strokeWidth={1.75} />}
        reserveLabels={[t("Stop all"), control.confirmLabel, t("Stopping…"), t("Retry stop")]}
        disabled={stopping}
        onBlur={() => setArmed(false)}
        onClick={press}
      >
        {text}
      </Button>
    </>
  );
}
