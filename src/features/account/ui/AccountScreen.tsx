import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Divider } from "../../../shared/ui/Divider";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import { TodayView } from "../../today";
import { useAccount } from "../hooks/useAccount";
import { AccountActivity } from "./AccountActivity";
import { AccountData } from "./AccountData";
import { AccountDevices } from "./AccountDevices";
import { AccountNews } from "./AccountNews";
import { AccountNotifications } from "./AccountNotifications";
import { AccountPrivacy } from "./AccountPrivacy";
import { AccountProfile } from "./AccountProfile";
import { AccountSecurity } from "./AccountSecurity";
import { AccountSignIn } from "./AccountSignIn";
import { AccountSupport, GuestSupport } from "./AccountSupport";
import { AccountStatus, isDeactivated } from "./AccountStatus";
import styles from "./account.module.css";

export type AccountTabId =
  | "profile"
  | "security"
  | "devices"
  | "activity"
  | "notifications"
  | "privacy"
  | "support"
  | "status";

/** Tabs a deactivated account can still use; the rest of the account API answers `account_deactivated`. */
const DEACTIVATED_TABS: readonly AccountTabId[] = ["profile", "privacy", "status"];

function tabItems(): { value: AccountTabId; label: string }[] {
  return [
    { value: "profile", label: t("Profile") },
    { value: "security", label: t("Security") },
    { value: "devices", label: t("Devices") },
    { value: "activity", label: t("Active time") },
    { value: "notifications", label: t("Notifications") },
    { value: "privacy", label: t("Privacy & data") },
    { value: "support", label: t("Support") },
    { value: "status", label: t("Account status") },
  ];
}

/**
 * The account center. Signed in it has one tab per area (profile, security on the web, devices,
 * active time, notifications, privacy and data, support, account status). Signed out it is a single
 * sign-in panel; the rest of the app never depends on it.
 */
export function AccountScreen() {
  useLocale();
  const { state, signIn, cancelSignIn, signOut, deactivate, reactivate } = useAccount();
  const [tab, setTab] = useState<AccountTabId>("profile");

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
        <AccountPrivacy />
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
      {deactivated ? (
        <InlineMessage tone="warning">
          {t("Your account is deactivated. Reactivate it under Account status to use it again.")}
        </InlineMessage>
      ) : null}
      <Tabs value={active} onValueChange={setTab} id="account-center">
        <div className={styles.tabScroll}>
          <TabList label={t("Account")} items={items} />
        </div>
        <TabPanel value="profile">
          <AccountProfile
            user={user}
            stale={state.stale}
            verifiedAt={state.verifiedAt}
            onSignOut={signOut}
          />
        </TabPanel>
        <TabPanel value="security">
          <AccountSecurity email={user.email} />
        </TabPanel>
        <TabPanel value="devices">
          <AccountDevices currentDeviceId={state.deviceId} onSignOutThisDevice={signOut} />
        </TabPanel>
        <TabPanel value="activity">
          <div className={styles.tabs}>
            <TodayView />
            <Divider />
            <AccountActivity />
          </div>
        </TabPanel>
        <TabPanel value="notifications">
          <div className={styles.tabs}>
            <AccountNotifications />
            <Divider />
            <AccountNews />
          </div>
        </TabPanel>
        <TabPanel value="privacy">
          <AccountData />
        </TabPanel>
        <TabPanel value="support" keepMounted>
          <AccountSupport />
        </TabPanel>
        <TabPanel value="status" keepMounted>
          <AccountStatus user={user} onDeactivate={deactivate} onReactivate={reactivate} />
        </TabPanel>
      </Tabs>
    </div>
  );
}
