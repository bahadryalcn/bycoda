import { useT } from "../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";
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
            <img src={PRODUCT_IDENTITY.logoSrc} alt="" draggable={false} />
            <img
              className="bycoda-brand-lettering"
              src={PRODUCT_IDENTITY.wordmarkSrc}
              alt=""
              draggable={false}
            />
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
