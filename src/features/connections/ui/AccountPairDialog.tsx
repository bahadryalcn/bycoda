import { t, useLocale } from "../../../shared/i18n";
import { useEffect } from "react";
import { useAccount, watchPairingView } from "../../account";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Text } from "../../../shared/ui/Text";
import type { AccountPairPlan } from "../model/accountDesktopPairing";
import type { RemoteMachine } from "../model/protocol";
import { useAccountDesktopPair, type AccountPairView } from "./useAccountDesktopPair";

function failureText(step: "denied" | "expired" | "unavailable" | "ticket" | "connection"): string {
  switch (step) {
    case "denied":
      return t("The other computer said no.");
    case "expired":
      return t("The request timed out before it was answered.");
    case "unavailable":
      return t("Could not send the request. Check your connection and sign-in, then try again.");
    case "ticket":
      return t("The other computer sent an unexpected answer.");
    case "connection":
      return t("Allowed, but this computer could not be reached on its published address.");
  }
}

function Body({ view }: { view: AccountPairView }) {
  if (view.step === "starting") return <LoadingText>{t("Sending the request…")}</LoadingText>;
  // Success closes the dialog through `onPaired`; nothing to show for that instant.
  if (view.step === "connected") return null;
  if (view.step === "waiting") {
    return (
      <div className="flex flex-col gap-3">
        <Text as="p" tone="primary">
          {t("Allow it there. It should show this code:")}
        </Text>
        <Text as="p" size="heading" weight="medium" tone="primary" tracking="wider">
          {view.code}
        </Text>
        <LoadingText>{t("Waiting for approval…")}</LoadingText>
      </div>
    );
  }
  return <Alert tone="danger">{failureText(view.step)}</Alert>;
}

/**
 * One-click add for a computer that only the account knows: asks it, shows the comparison
 * code and saves the machine once its owner allows. `onPaired` receives the saved machine.
 */
export function AccountPairDialog({
  plan,
  onClose,
  onPaired,
}: {
  plan: AccountPairPlan;
  onClose: () => void;
  onPaired: (machine: RemoteMachine) => void;
}) {
  useLocale();
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps account mailbox discovery responsive while this pairing dialog is mounted.
  useEffect(watchPairingView, []);
  const { view, retry, signedIn } = useAccountDesktopPair(plan);
  const { signIn } = useAccount();
  const connected = view.step === "connected" ? view.machine : undefined;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Closes the dialog once the pairing connected; the saved machine goes to the caller.
  useEffect(() => {
    if (connected) onPaired(connected);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Fires once per connected machine; a new `onPaired` identity must not repeat it.
  }, [connected]);
  const failed = view.step !== "starting" && view.step !== "waiting" && !connected;
  return (
    <Modal
      title={t("Add {p0}", { p0: plan.name })}
      size="sm"
      onClose={onClose}
      footer={
        <ModalActions>
          {failed ? (
            <Button variant="secondary" onClick={retry}>
              {t("Try again")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
        </ModalActions>
      }
    >
      {signedIn ? (
        <Body view={view} />
      ) : (
        <Alert
          tone="warning"
          action={{ label: t("Sign in"), onClick: () => void signIn().catch(() => undefined) }}
        >
          {t("Sign in to add this computer.")}
        </Alert>
      )}
    </Modal>
  );
}
