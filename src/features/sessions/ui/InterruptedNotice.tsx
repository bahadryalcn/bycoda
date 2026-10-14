import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Pause, Play } from "../../../shared/ui/icons";

/**
 * A turn that was cut off when Bycoda quit, and was not continued on its own:
 * the setting is off, the transcript did not settle whether it ended, or the
 * user had follow-ups queued. Continue is the user's call. A host chat shows it
 * too when the host recorded the turn as lost.
 */
export function InterruptedNotice({
  onContinue,
  message = `This turn was cut off when ${PRODUCT_IDENTITY.displayName} quit.`,
}: {
  onContinue: () => void;
  message?: string;
}) {
  useLocale();
  return (
    <div className="px-2 text-content/55" data-interrupted-turn>
      <div className="relative z-0 flex h-8 items-center gap-2 rounded-t-[10px] border border-b-0 border-warning/25 bg-warning/10 px-2 text-[12px]">
        <Pause className="size-3.5 shrink-0 text-warning" />
        <span className="shrink-0 text-content/85">{t("Interrupted")}</span>
        <span className="min-w-0 flex-1 truncate">{message}</span>
        <button
          type="button"
          onClick={onContinue}
          className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/10 hover:text-content"
        >
          <Play className="size-3.5" />
          {t("Continue")}
        </button>
      </div>
    </div>
  );
}
