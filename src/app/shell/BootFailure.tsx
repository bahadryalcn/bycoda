import { Button } from "../../shared/ui/Button";
import { t, useLocale } from "../../shared/i18n";
import { useState } from "react";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";

/** Must stay independent of App so a failed App chunk can still recover. */
export function BootFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  useLocale();
  const [details, setDetails] = useState(false);
  const message = error instanceof Error ? error.message : "Startup could not be completed.";
  return (
    <main className="grid h-dvh place-items-center bg-background-base p-6 text-content">
      <section role="alert" className="w-full max-w-md space-y-4">
        <h1 className="text-xl font-medium">
          {PRODUCT_IDENTITY.displayName}
          {t(" couldn’t start")}
        </h1>
        <p className="text-sm text-content/75">
          {t("Your saved workspace is still available. Reload the app to try again.")}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="ghost"
            motion="none"
            type="button"
            autoFocus
            onClick={onRetry}
            className=""
          >
            {t("Reload app")}
          </Button>
          <Button
            variant="ghost"
            motion="none"
            type="button"
            aria-expanded={details}
            onClick={() => setDetails(!details)}
            className=""
          >
            {details ? t("Hide details") : t("Show details")}
          </Button>
        </div>
        {details ? (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-content/15 p-3 text-xs">
            {message}
          </pre>
        ) : null}
      </section>
    </main>
  );
}
