import { useDelayedVisible } from "../../shared/hooks/useDelayedVisible";
import { useT } from "../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";
import { Button } from "../../shared/ui/Button";
import { LiveText } from "../../shared/ui/LiveText";

/** A normal boot never shows the recovery text or Retry; they appear once the workspace read is this slow. */
export const BOOT_SLOW_AFTER_MS = 10_000;

const DARK_BOOT_LOGO = "/brand/bycoda/mark-tea-red-loading.svg";

/** The mark the HTML splash drew (`window.__bootLogo`, picked from the saved scheme), so the handoff keeps one logo. */
function bootLogoSrc(): string {
  const chosen = (window as { __bootLogo?: unknown }).__bootLogo;
  return typeof chosen === "string" && chosen ? chosen : DARK_BOOT_LOGO;
}

/**
 * First React frame under the HTML splash: the same centred mark on the themed canvas, nothing else.
 * Name, status and Retry appear below it only when the wait is slow, so the logo never moves.
 */
export function BootLoading({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  const slow = useDelayedVisible(true, { delay: BOOT_SLOW_AFTER_MS });
  return (
    <div className="bycoda-boot-loading">
      <img src={bootLogoSrc()} alt="" aria-hidden="true" width={72} height={72} draggable={false} />
      {slow ? (
        <div className="bycoda-boot-loading-details">
          <strong>{PRODUCT_IDENTITY.displayName}</strong>
          <LiveText text={t("Restoring your workspace and saved drafts…")} />
          <Button motion="none" onClick={onRetry}>
            {t("Retry loading")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
