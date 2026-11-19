import { useT } from "../../shared/i18n";
import { BrandMark } from "../../shared/ui/BrandMark";
import { FailureState, isModuleLoadError } from "../../shared/ui/FailureState";

/** Must stay independent of App so a failed App chunk can still recover. */
export function BootFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  return (
    <main>
      <FailureState
        fullScreen
        brand={
          <div className="bycoda-wordmark bycoda-boot-brand">
            <BrandMark draggable={false} />
            <BrandMark variant="wordmark" className="bycoda-brand-lettering" draggable={false} />
          </div>
        }
        title={t("Couldn’t start")}
        description={
          isModuleLoadError(error)
            ? import.meta.env.DEV
              ? t("Reload, or check the development server output.")
              : t("Reload to restore the application files.")
            : t("Your saved workspace is still available.")
        }
        error={error}
        onRetry={onRetry}
        retryLabel={t("Reload app")}
      />
    </main>
  );
}
