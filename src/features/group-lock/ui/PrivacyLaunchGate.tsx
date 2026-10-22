import { useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Shield } from "../../../shared/ui/icons";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { useGroupLock } from "../hooks/useGroupLock";
import { getGroupLockView, verifyLockPassword } from "../model/groupLock";
import { ForgotLockPasswordDialog } from "./ForgotLockPasswordDialog";
import { PasswordPromptDialog } from "./PasswordPromptDialog";

/** Each window decides at launch. Its workspace never mounts behind the screen. */
export function PrivacyLaunchGate({ children }: { children: ReactNode }) {
  useLocale();
  const [concealed, setConcealed] = useState(() => getGroupLockView().settings.startInPrivacyMode);
  const lock = useGroupLock();
  const [dialog, setDialog] = useState<"password" | "recovery" | null>(null);
  if (!concealed) return children;

  return (
    <main className="flex h-dvh flex-col bg-background-base text-content">
      <div data-tauri-drag-region className="h-10 shrink-0" />
      <div className="flex flex-1 items-center justify-center px-6 pb-10">
        <section
          aria-labelledby="privacy-launch-title"
          className="flex w-full max-w-sm flex-col items-center gap-5 text-center"
        >
          <Shield aria-hidden className="size-10 text-content/50" strokeWidth={1.5} />
          <div>
            <p className="mb-2 text-xs text-content/50">{PRODUCT_IDENTITY.displayName}</p>
            <h1 id="privacy-launch-title" className="text-xl font-medium">
              {t("Privacy mode")}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-content/65">
              {t("Your workspace is hidden. Continue when you are ready.")}
            </p>
          </div>
          <SecondaryButton
            onClick={() => (lock.hasPassword ? setDialog("password") : setConcealed(false))}
          >
            {t("Show workspace")}
          </SecondaryButton>
          {lock.hasPassword ? (
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
    </main>
  );
}
