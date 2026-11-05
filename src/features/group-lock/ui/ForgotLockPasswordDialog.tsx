import { useLayoutEffect, useRef } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Alert } from "../../../shared/ui/Alert";
import { useConfirm, type ConfirmRequest } from "../../../shared/ui/ConfirmDialog";
import { resetForgottenPassword } from "../model/groupLock";
import { incompleteMessage } from "./PasswordPromptDialog";

const PHRASE = "reset lock";

type Props = { onClose: () => void };

export function ForgotLockPasswordDialog({ onClose }: Props) {
  useLocale();
  const { confirmWith, renderDialog } = useConfirm();
  const callbacks = useRef(onClose);
  const generation = useRef(0);
  callbacks.current = onClose;
  const request: ConfirmRequest = {
    title: t("Reset lock password"),
    message: t("Removes the password and every group lock."),
    confirmLabel: t("Reset lock"),
    requireText: { text: PHRASE, label: `${t("Type “")}${PHRASE}${t("” to confirm")}` },
    body: (
      <>
        <p className="text-ui-caption leading-snug">
          {t("The password cannot be recovered. Resetting removes it and unlocks all groups. Their projects stay in the groups and nothing is deleted. You can set a new password afterwards and lock groups again.")}
        </p>
        <Alert tone="warning">
          {PRODUCT_IDENTITY.displayName}
          {t(" cannot check who you are, so anyone using this computer can do this. The lock is a privacy screen, not a security boundary.")}
        </Alert>
      </>
    ),
    onConfirm: async () => {
      const outcome = await resetForgottenPassword();
      if (outcome !== "complete") throw new Error(incompleteMessage(outcome));
    },
  };
  useLayoutEffect(() => {
    const current = ++generation.current;
    void confirmWith(request).then(
      () => generation.current === current && callbacks.current(),
      (error: unknown) => {
        console.error("Forgot lock password confirmation failed", error);
        if (generation.current === current) callbacks.current();
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once; renderDialog supplies current request content.
    return () => {
      generation.current += 1;
    };
  }, []);
  return renderDialog(request);
}
