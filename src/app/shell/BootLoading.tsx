import { useDelayedVisible } from "../../shared/hooks/useDelayedVisible";
import { useT } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { LiveText } from "../../shared/ui/LiveText";

/** A normal boot never shows the recovery text or Retry; they appear once the workspace read is this slow. */
export const BOOT_SLOW_AFTER_MS = 10_000;

const DARK_BOOT_LOGO = "/brand/bycoda/mark-tea-red-loading.svg";
const DARK_BOOT_WORDMARK = "/brand/bycoda/wordmark-white.svg";

/** The asset the HTML splash drew (picked from the saved scheme), so the handoff keeps one lockup. */
function splashSrc(key: "__bootLogo" | "__bootWordmark", fallback: string): string {
  const chosen = (window as { __bootLogo?: unknown; __bootWordmark?: unknown })[key];
  return typeof chosen === "string" && chosen ? chosen : fallback;
}

/**
 * First React frame under the HTML splash: the same centred mark and wordmark on the themed canvas.
 * Status and Reload appear below them only when the wait is slow, so the lockup never moves.
 */
export function BootLoading({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  const slow = useDelayedVisible(true, { delay: BOOT_SLOW_AFTER_MS });
  return (
    <div className="bycoda-boot-loading">
      <img
        src={splashSrc("__bootLogo", DARK_BOOT_LOGO)}
        alt=""
        aria-hidden="true"
        width={72}
        height={72}
        draggable={false}
      />
      <img
        className="bycoda-boot-loading-wordmark"
        src={splashSrc("__bootWordmark", DARK_BOOT_WORDMARK)}
        alt=""
        aria-hidden="true"
        width={120}
        height={24}
        draggable={false}
      />
      {slow ? (
        <div className="bycoda-boot-loading-details">
          <LiveText text={t("Restoring your workspace and saved drafts…")} />
          <Button motion="none" onClick={onRetry}>
            {t("Reload")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
