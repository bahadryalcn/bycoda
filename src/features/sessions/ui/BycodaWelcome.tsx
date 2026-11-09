import { useT } from "../../../shared/i18n";
import { useEffect } from "react";
import type { HarnessId } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import { useDecorativeMotionEnabled } from "../../settings/public/decorativeMotion";

/** Acknowledge a model change with the selected provider's mark. */
export function BycodaWelcome({ harness, onDone }: { harness: HarnessId; onDone: () => void }) {
  const t = useT();
  const motion = useDecorativeMotionEnabled();
  useEffect(() => {
    if (!motion) {
      onDone();
      return;
    }
    const timer = window.setTimeout(onDone, 1400);
    return () => window.clearTimeout(timer);
  }, [motion, onDone]);
  if (!motion) return null;
  return (
    <div className="bycoda-welcome pointer-events-none" aria-hidden="true">
      <HarnessIcon harness={harness} className="bycoda-welcome-icon" />
      <span>{t("Ready to work together")}</span>
    </div>
  );
}
