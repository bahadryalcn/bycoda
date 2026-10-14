import { t, useLocale } from "../../../shared/i18n";
import { useCallback, useEffect, useState } from "react";
import { loginHarness } from "../../../integrations/harness/core/auth";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import { Modal } from "../../../shared/ui/Modal";
import { ProviderSignInPanel, type ProviderSignInState } from "./ProviderSignInPanel";

type Props = {
  harness: HarnessId;
  accountId?: string;
  onClose: () => void;
  onSignedIn?: () => void;
  completeDescription?: string;
};

export function ProviderSignInDialog({
  harness,
  accountId,
  onClose,
  onSignedIn,
  completeDescription,
}: Props) {
  useLocale();
  const [state, setState] = useState<ProviderSignInState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setState("idle");
    setError(null);
  }, [harness, accountId]);

  const signIn = useCallback(() => {
    setState("running");
    setError(null);
    void loginHarness(harness, accountId).then(
      () => {
        setState("complete");
        onSignedIn?.();
      },
      (reason: unknown) => {
        setState("error");
        setError(
          reason instanceof Error
            ? reason.message
            : `Could not sign in to ${HARNESS_TITLE[harness]}.`,
        );
      },
    );
  }, [harness, accountId, onSignedIn]);

  return (
    <Modal
      onClose={onClose}
      title={t("Authentication required")}
      description={t("Sign in to continue using {p0}.", { p0: HARNESS_TITLE[harness] })}
      size="sm"
      minimalHeader
    >
      <ProviderSignInPanel
        harness={harness}
        state={state}
        error={error}
        onSignIn={signIn}
        onComplete={onClose}
        completeActionLabel="Continue"
        completeDescription={completeDescription}
        autoFocus
      />
    </Modal>
  );
}
