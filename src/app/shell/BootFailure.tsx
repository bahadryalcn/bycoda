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
        title={PRODUCT_IDENTITY.displayName + t(" couldn’t start")}
        description={
          isModuleLoadError(error)
            ? import.meta.env.DEV
              ? t(
                  "The development server could not load an application module. Reload the app. If this continues, check the dev server output and restart it.",
                )
              : t(
                  "An application module could not be loaded. Reload the app to get the latest files.",
                )
            : t("Your saved workspace is still available. Reload the app to try again.")
        }
        error={error}
        onRetry={onRetry}
        retryLabel={t("Reload app")}
      />
    </main>
  );
}
