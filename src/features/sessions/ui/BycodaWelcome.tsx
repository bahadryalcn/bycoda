import { useT } from "../../../shared/i18n";
import { useEffect } from "react";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useDecorativeMotionEnabled } from "../../settings/model/decorativeMotion";

/** Shared, provider-independent acknowledgment of a model change. */
export function BycodaWelcome({ onDone }: { onDone: () => void }) {
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
      <img src={PRODUCT_IDENTITY.logoSrc} alt="" />
      <span>{t("Ready to work together")}</span>
    </div>
  );
}
