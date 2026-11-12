import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Heading } from "../../../shared/ui/Heading";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import type { HarnessId } from "../model/session";
import { HARNESS_TITLE } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import { Check } from "../../../shared/ui/icons";

export type ProviderSignInState = "idle" | "running" | "complete" | "error";

export function ProviderSignInPanel({
  harness,
  state,
  error,
  onSignIn,
  onComplete,
  completeActionLabel,
  autoFocus = false,
  idleTitle,
  completeDescription,
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
    <div className="flex min-h-68 flex-col items-center justify-center px-5 py-6" role="status">
      <Text
        size="inherit"
        tone="neutral"
        {...surfaceAttributes(
          { variant: "raised" },
          "grid size-16 place-items-center rounded-2xl  ring-1 ring-inset ring-(--color-stroke) shadow-sm",
        )}
      >
        <HarnessIcon harness={harness} className="size-9" />
      </Text>
      <Heading size="page" level={2} className="mt-3.5">
        {complete
          ? t("Signed in to {p0}", { p0: title })
          : (idleTitle ?? t("Authentication required"))}
      </Heading>
      <Text as="p" size="micro" tone="secondary" className="mt-1 max-w-56">
        {complete
          ? (completeDescription ?? t("You can retry your last message now."))
          : t("Sign in to continue using {p0}.", { p0: title })}
      </Text>
      <Button
        reserveLabels={[t("Waiting for browser…")]}
        variant="primary"
        type="button"
        autoFocus={autoFocus}
        className="mt-4"
        disabled={state === "running" || (complete && !onComplete)}
        loading={state === "running"}
        startIcon={complete ? <Check className="icon-sm" aria-hidden /> : undefined}
        onClick={complete && onComplete ? onComplete : onSignIn}
      >
        {state === "running"
          ? t("Waiting for browser…")
          : complete
            ? (completeActionLabel ?? t("Signed in"))
            : t("Sign in to {p0}", { p0: title })}
      </Button>
      {state === "error" && error ? (
        <Text as="p" size="caption" tone="danger" className="mt-2.5 max-w-60" role="status">
          {error}
        </Text>
      ) : null}
    </div>
  );
}
