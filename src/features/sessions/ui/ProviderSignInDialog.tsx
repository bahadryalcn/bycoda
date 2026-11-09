import { useT } from "../../../shared/i18n";
import { useCallback, useState } from "react";
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
  const t = useT();
  // The attempt belongs to the provider account it started for; another account starts idle.
  const ownerKey = `${harness}\u0000${accountId ?? ""}`;
  const [attempt, setAttempt] = useState<{
    key: string;
    state: ProviderSignInState;
    error: string | null;
  }>({ key: ownerKey, state: "idle", error: null });
  const current = attempt.key === ownerKey ? attempt : null;
  const state: ProviderSignInState = current?.state ?? "idle";
  const error = current?.error ?? null;

  const signIn = useCallback(() => {
    setAttempt({ key: ownerKey, state: "running", error: null });
    void loginHarness(harness, accountId).then(
      () => {
        setAttempt({ key: ownerKey, state: "complete", error: null });
        onSignedIn?.();
      },
      (reason: unknown) => {
        setAttempt({
          key: ownerKey,
          state: "error",
          error:
            reason instanceof Error
              ? reason.message
              : `Could not sign in to ${HARNESS_TITLE[harness]}.`,
        });
      },
    );
  }, [harness, accountId, ownerKey, onSignedIn]);

  return (
    <Modal
      padding="none"
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
