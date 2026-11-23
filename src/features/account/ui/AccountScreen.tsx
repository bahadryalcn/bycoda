import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Divider } from "../../../shared/ui/Divider";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import { TodayView } from "../../today";
import { openSettingsSection } from "../../settings/public/settingsLink";
import { useAccount } from "../hooks/useAccount";
import { accountController } from "../model/accountService";
import { AccountData } from "./AccountData";
import { AccountDevices } from "./AccountDevices";
import { AccountHeader } from "./AccountHeader";
import { AccountNews } from "./AccountNews";
import { AccountProfile } from "./AccountProfile";
import { AccountSecurity } from "./AccountSecurity";
import { AccountSignIn } from "./AccountSignIn";
import { AccountSupport, GuestSupport } from "./AccountSupport";
import { AccountStatus, isDeactivated } from "./AccountStatus";
import styles from "./account.module.css";

export type AccountTabId = "account" | "activity" | "notifications" | "privacy" | "support";

/** Tabs a deactivated account can still use; the rest of the account API answers `account_deactivated`. */
const DEACTIVATED_TABS: readonly AccountTabId[] = ["account", "privacy"];

function tabItems(): { value: AccountTabId; label: string }[] {
  return [
    { value: "account", label: t("Account") },
    { value: "activity", label: t("Active time") },
    { value: "notifications", label: t("Notifications") },
    { value: "privacy", label: t("Privacy & data") },
    { value: "support", label: t("Support") },
  ];
}

/**
 * The account center. Signed in it shows who is signed in above one tab strip of five areas:
 * account (profile, security, devices), active time, notifications, privacy and data (with
 * deactivate and delete) and support. Signed out it is a single sign-in panel; the rest of the app
 * never depends on it.
 */
export function AccountScreen() {
  useLocale();
  const { state, signIn, cancelSignIn, signOut, deactivate, reactivate } = useAccount();
  const [tab, setTab] = useState<AccountTabId>("account");
  const [visited, setVisited] = useState<{ userId: string; tabs: AccountTabId[] }>({
    userId: "",
    tabs: [],
  });
  const stale = state.phase === "signed-in" && state.stale;
  // Refresh cached account facts without blocking offline navigation.
  useEffect(() => {
    if (stale)
      accountController()
        .revalidate()
        .catch(() => undefined); // -- failures are classified inside; the notice stays.
  }, [stale]);

  if (state.phase === "starting") {
    return (
      <div className={styles.screen}>
        <LoadingText>{t("Loading account…")}</LoadingText>
      </div>
    );
  }
  if (state.phase === "unavailable") {
    return (
      <div className={styles.screen}>
        <InlineMessage tone="neutral">
          {t("Accounts are not available in this build of bycoda.")}
        </InlineMessage>
      </div>
    );
  }
  if (state.phase !== "signed-in") {
    return (
      <div className={styles.screen}>
        <AccountSignIn
          state={state}
          onSignIn={() => signIn().catch(() => undefined)}
          onCancel={() => cancelSignIn().catch(() => undefined)}
        />
        <Divider />
        <TodayView />
        <Divider />
        <GuestSupport />
      </div>
    );
  }

  const user = state.context.user;
  const deactivated = isDeactivated(user);
  const items = tabItems().filter((item) => !deactivated || DEACTIVATED_TABS.includes(item.value));
  const active = items.some((item) => item.value === tab) ? tab : items[0]!.value;
  return (
    <div className={styles.screen}>
      <AccountHeader
        context={state.context}
        stale={state.stale}
        verifiedAt={state.verifiedAt}
        onSignOut={signOut}
      />
      {deactivated ? (
        <InlineMessage tone="warning">
          {t("Your account is deactivated. Reactivate it under Privacy & data to use it again.")}
        </InlineMessage>
      ) : null}
      <Tabs
        key={user.id}
        value={active}
        onValueChange={(next) => {
          setTab(next as AccountTabId);
          setVisited((current) => ({
            userId: user.id,
            tabs: [
              ...new Set([
                ...(current.userId === user.id ? current.tabs : []),
                next as AccountTabId,
              ]),
            ],
          }));
        }}
        id="account-center"
      >
        <div className={styles.layout}>
          <nav className={styles.nav}>
            <TabList label={t("Account")} items={items} scroll="wrap" />
          </nav>
          <div className={styles.panel}>
            <TabPanel value="account">
              <div className={styles.tabs}>
                <AccountProfile user={user} />
                {deactivated ? null : (
                  <>
                    <AccountSecurity user={user} />
                    <AccountDevices
                      currentDeviceId={state.deviceId}
                      onSignOutThisDevice={signOut}
                    />
                  </>
                )}
              </div>
            </TabPanel>
            <TabPanel value="activity" keepMounted>
              <div className={styles.tabs}>
                {active === "activity" ||
                (visited.userId === user.id && visited.tabs.includes("activity")) ? (
                  <TodayView />
                ) : null}
              </div>
            </TabPanel>
            <TabPanel value="notifications">
              <div className={styles.tabs}>
                <Button variant="secondary" onClick={() => openSettingsSection("notifications")}>
                  {t("Notification settings…")}
                </Button>
                <Divider />
                <AccountNews />
              </div>
            </TabPanel>
            <TabPanel value="privacy" keepMounted>
              <div className={styles.tabs}>
                {active === "privacy" ||
                (visited.userId === user.id && visited.tabs.includes("privacy")) ? (
                  <>
                    <AccountData />
                    <AccountStatus
                      user={user}
                      onDeactivate={deactivate}
                      onReactivate={reactivate}
                    />
                  </>
                ) : null}
              </div>
            </TabPanel>
            <TabPanel value="support" keepMounted>
              <AccountSupport />
            </TabPanel>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
