import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import type { HarnessId } from "../model/session";
import { HARNESS_TITLE } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import { Check, RefreshCw } from "../../../shared/ui/icons";

export type ProviderSignInState = "idle" | "running" | "complete" | "error";

export function ProviderSignInPanel({
  harness,
  state,
  error,
  onSignIn,
  onComplete,
  completeActionLabel,
  autoFocus = false,
  idleTitle = "Authentication required",
  completeDescription = "You can retry your last message now.",
}: {
  harness: HarnessId;
  state: ProviderSignInState;
  error: string | null;
  onSignIn: () => void;
  onComplete?: () => void;
  completeActionLabel?: string;
  autoFocus?: boolean;
  idleTitle?: string;
  completeDescription?: string;
}) {
  const t = useT();
  const title = HARNESS_TITLE[harness];
  const complete = state === "complete";

  return (
    <div
      className="flex min-h-68 flex-col items-center justify-center px-5 py-6"
      aria-live="polite"
    >
      <span className="grid size-16 place-items-center rounded-2xl bg-(--ui-surface-raised) text-(--ui-tone-neutral-fg) ring-1 ring-inset ring-(--color-stroke) shadow-sm">
        <HarnessIcon harness={harness} className="size-9" />
      </span>
      <h2 className="mt-3.5 text-ui-title font-medium leading-5 text-(--ui-tone-neutral-fg)">
        {complete ? t("Signed in to {p0}", { p0: title }) : idleTitle}
      </h2>
      <p className="mt-1 max-w-56 text-ui-micro leading-4 text-(--ui-text-secondary)">
        {complete ? completeDescription : t("Sign in to continue using {p0}.", { p0: title })}
      </p>
      <Button
        variant="primary"
        type="button"
        autoFocus={autoFocus}
        className="mt-4"
        disabled={state === "running" || (complete && !onComplete)}
        onClick={complete && onComplete ? onComplete : onSignIn}
      >
        {state === "running" ? (
          <RefreshCw className="size-3.5 animate-spin" aria-hidden />
        ) : complete ? (
          <Check className="size-3.5" aria-hidden />
        ) : null}
        {state === "running"
          ? t("Waiting for browser…")
          : complete
            ? (completeActionLabel ?? t("Signed in"))
            : t("Sign in to {p0}", { p0: title })}
      </Button>
      {state === "error" && error ? (
        <p
          className="mt-2.5 max-w-60 text-(length:--ui-font-caption) leading-4 text-(--ui-tone-danger-fg)"
          role="status"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
