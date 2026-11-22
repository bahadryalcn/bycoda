import { t, useLocale } from "../../../shared/i18n";
import { useEffect } from "react";
import { watchPairingView } from "../../account";
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

function Body({ view, name }: { view: AccountPairView; name: string }) {
  if (view.step === "starting") return <LoadingText>{t("Sending the request…")}</LoadingText>;
  if (view.step === "connected") {
    return <Alert tone="success">{t("Connected to {p0}.", { p0: name })}</Alert>;
  }
  if (view.step === "waiting") {
    return (
      <div className="flex flex-col gap-3">
        <Text as="p" tone="primary">
          {t("Allow it on {p0}. It should show this code:", { p0: name })}
        </Text>
        <Text as="p" size="heading" weight="medium" tone="primary" tracking="wider">
          {view.code}
        </Text>
        <LoadingText>{t("Waiting for approval on {p0}…", { p0: name })}</LoadingText>
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
  const done = view.step === "connected";
  const failed = view.step !== "starting" && view.step !== "waiting" && !done;
  return (
    <Modal
      title={t("Add {p0}", { p0: plan.name })}
      size="sm"
      onClose={done ? () => onPaired(view.machine) : onClose}
      footer={
        <ModalActions>
          {failed ? (
            <Button variant="secondary" onClick={retry}>
              {t("Try again")}
            </Button>
          ) : null}
          <Button
            variant={done ? "primary" : "ghost"}
            onClick={done ? () => onPaired(view.machine) : onClose}
          >
            {done ? t("Done") : t("Cancel")}
          </Button>
        </ModalActions>
      }
    >
      {signedIn ? (
        <Body view={view} name={plan.name} />
      ) : (
        <Alert tone="warning">{t("Sign in to add this computer.")}</Alert>
      )}
    </Modal>
  );
}
