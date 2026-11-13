import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Heading } from "../../../shared/ui/Heading";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Shield } from "../../../shared/ui/icons";
import { useGroupLock } from "../hooks/useGroupLock";
import { getGroupLockView, verifyLockPassword } from "../model/groupLock";
import { ForgotLockPasswordDialog } from "./ForgotLockPasswordDialog";
import { PasswordPromptDialog } from "./PasswordPromptDialog";
import { PrivacyStorageError } from "./PrivacyStorageError";

/** Each window decides at launch. Its workspace never mounts behind the screen. */
export function PrivacyLaunchGate({ children }: { children: ReactNode }) {
  useLocale();
  const [concealed, setConcealed] = useState(() => {
    const initial = getGroupLockView();
    return initial.storageAvailable === false || initial.settings.startInPrivacyMode;
  });
  const lock = useGroupLock();
  const [lastStorageAvailable, setLastStorageAvailable] = useState(lock.storageAvailable);
  const [dialog, setDialog] = useState<"password" | "recovery" | null>(null);
  // A later fault also latches concealment. A successful read is never a Continue action.
  if (lastStorageAvailable !== lock.storageAvailable) {
    setLastStorageAvailable(lock.storageAvailable);
    if (lock.storageAvailable === false) setConcealed(true);
  }
  if (!concealed && lock.storageAvailable !== false) return children;

  return (
    <Text
      as="main"
      size="inherit"
      tone="primary"
      {...surfaceAttributes({ variant: "base" }, "flex h-dvh flex-col")}
    >
      <div data-tauri-drag-region className="h-10 shrink-0" />
      <div className="flex flex-1 items-center justify-center px-6 pb-10">
        <section
          aria-labelledby="privacy-launch-title"
          className="flex w-full max-w-sm flex-col items-center gap-5 text-center"
        >
          <Shield aria-hidden className="size-10" tone="muted" strokeWidth={1.75} />
          <div>
            <Text as="p" size="caption" tone="muted" className="mb-2">
              {PRODUCT_IDENTITY.displayName}
            </Text>
            <Heading size="page" id="privacy-launch-title">
              {t("Privacy mode")}
            </Heading>
            <Text as="p" size="body" tone="secondary" leading="relaxed" className="mt-3">
              {t("Your workspace is hidden. Continue when you are ready.")}
            </Text>
          </div>
          {lock.storageAvailable === false ? (
            <PrivacyStorageError />
          ) : (
            <Button
              className="shrink-0"
              onClick={() => (lock.hasPassword ? setDialog("password") : setConcealed(false))}
            >
              {t("Show workspace")}
            </Button>
          )}
          {lock.storageAvailable !== false && lock.hasPassword ? (
            <Button type="button" variant="ghost" onClick={() => setDialog("recovery")}>
              {t("Forgot the password?")}
            </Button>
          ) : null}
        </section>
      </div>
      {dialog === "password" ? (
        <PasswordPromptDialog
          title={t("Show workspace")}
          description={t("Enter your lock password to leave privacy mode.")}
          submitLabel={t("Show workspace")}
          verify={verifyLockPassword}
          onDone={() => {
            setDialog(null);
            setConcealed(false);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "recovery" ? <ForgotLockPasswordDialog onClose={() => setDialog(null)} /> : null}
    </Text>
  );
}
