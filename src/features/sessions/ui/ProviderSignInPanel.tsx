import { useSyncExternalStore } from "react";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Heading } from "../../../shared/ui/Heading";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import type { HarnessId } from "../model/session";
import { HARNESS_TITLE } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import { Check } from "../../../shared/ui/icons";
import { Code } from "../../../shared/ui/Code";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { openExternal } from "../../../platform/tauri/openExternal";
import {
  getSignInInstructions,
  signInInstructionsKey,
  subscribeSignInInstructions,
} from "../../../integrations/harness/core/authInstructions";

export type ProviderSignInState = "idle" | "running" | "complete" | "error";

export function ProviderSignInPanel({
  harness,
  accountId,
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
  /** Account the sign-in runs for; picks which run's browser fallback link and code are shown. */
  accountId?: string;
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
  const instructionsKey = signInInstructionsKey(harness, accountId);
  const printed = useSyncExternalStore(subscribeSignInInstructions, () =>
    getSignInInstructions(instructionsKey),
  );
  const instructions = state === "running" ? printed : undefined;

  return (
    <div className="flex min-h-68 flex-col items-center justify-center px-5 py-6" role="status">
      <Text
        size="inherit"
        tone="neutral"
        {...surfaceAttributes(
          { variant: "card", ring: "pane", radius: "well" },
          "grid size-16 place-items-center",
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
      {instructions ? (
        <div className="mt-3 flex max-w-60 flex-col items-center gap-2 text-center">
          <Text as="p" size="caption" tone="secondary">
            {t("If your browser did not open, finish sign-in with this.")}
          </Text>
          {instructions.code ? (
            <>
              <Code variant="block" tone="primary" tracking="wide" className="select-all">
                {instructions.code}
              </Code>
              <CopyButton
                size="sm"
                label={t("Copy code")}
                text={instructions.code}
                resetKeys={[instructions.code]}
              />
            </>
          ) : null}
          {instructions.url ? (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                type="button"
                onClick={() => {
                  openExternal(instructions.url!).catch((cause: unknown) => {
                    console.error("Failed to open sign-in link:", cause);
                  });
                }}
              >
                {t("Open sign-in link")}
              </Button>
              <CopyButton
                size="sm"
                label={t("Copy link")}
                text={instructions.url}
                resetKeys={[instructions.url]}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {state === "error" && error ? (
        <Text as="p" size="caption" tone="danger" className="mt-2.5 max-w-60" role="status">
          {error}
        </Text>
      ) : null}
    </div>
  );
}
