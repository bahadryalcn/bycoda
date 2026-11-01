import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Alert } from "../../../shared/ui/Alert";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { resetForgottenPassword } from "../model/groupLock";
import { incompleteMessage } from "./PasswordPromptDialog";

const PHRASE = "reset lock";

type Props = {
  onClose: () => void;
};

/**
 * The way out when the password is lost: it removes the password and the lock
 * from every group. Bycoda cannot tell who is at the keyboard, so the only
 * safeguard is a deliberate confirmation phrase (the shared type-to-confirm).
 */
export function ForgotLockPasswordDialog({ onClose }: Props) {
  useLocale();
  return (
    <ConfirmDialog
      onSettle={() => onClose()}
      request={{
        title: t("Reset lock password"),
        message: t("Removes the password and every group lock."),
        confirmLabel: t("Reset lock"),
        requireText: {
          text: PHRASE,
          label: `${t("Type “")}${PHRASE}${t("” to confirm")}`,
        },
        body: (
          <>
            <p className="text-ui-caption leading-snug">
              {t(
                "The password cannot be recovered. Resetting removes it and unlocks all groups. Their projects stay in the groups and nothing is deleted. You can set a new password afterwards and lock groups again.",
              )}
            </p>
            <Alert tone="warning">
              {PRODUCT_IDENTITY.displayName}
              {t(
                " cannot check who you are, so anyone using this computer can do this. The lock is a privacy screen, not a security boundary.",
              )}
            </Alert>
          </>
        ),
        // Keep the dialog so the real outcome stays visible; `not-saved` can be retried.
        onConfirm: () => {
          const outcome = resetForgottenPassword();
          if (outcome !== "complete") throw new Error(incompleteMessage(outcome));
        },
      }}
    />
  );
}
