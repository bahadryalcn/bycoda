import { useState } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { InlineError } from "../../../shared/ui/InlineError";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { securityUrl } from "../model/accountPortal";
import styles from "./account.module.css";

/** Sign-in security lives on the web account page, where the sign-in provider has a session. */
export function AccountSecurity({ email }: { email: string }) {
  useLocale();
  const [openFailed, setOpenFailed] = useState(false);
  const url = securityUrl();
  return (
    <section className={styles.section} aria-labelledby="account-security">
      <SectionLabel labelId="account-security">{t("Security")}</SectionLabel>
      <p className={styles.lead}>
        {t(
          "Your e-mail address, connected accounts, two-step verification and signed-in sessions are managed on your bycoda account page in the browser.",
        )}
      </p>
      <DescriptionList columns={1} size="sm">
        <DescriptionItem term={t("E-mail")}>{email}</DescriptionItem>
      </DescriptionList>
      {url ? (
        <div className={styles.actions}>
          <Button
            variant="secondary"
            onClick={() => {
              setOpenFailed(false);
              openExternal(url).catch(() => setOpenFailed(true));
            }}
          >
            {t("Manage security on the web")}
          </Button>
        </div>
      ) : null}
      {url && openFailed ? (
        <InlineError>{t("Could not open your browser. Go to {p0}.", { p0: url })}</InlineError>
      ) : null}
    </section>
  );
}
