import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { observeResize } from "../../../shared/lib/observeResize";
import { t, useLocale } from "../../../shared/i18n";
import { Divider } from "../../../shared/ui/Divider";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import {
  CircleAlert,
  CircleHelp,
  Clock,
  Lock,
  MessageSquare,
  MonitorSmartphone,
  Shield,
  UserRound,
} from "../../../shared/ui/icons";
import { TodayView } from "../../today";
import { useAccount } from "../hooks/useAccount";
import { accountController } from "../model/accountService";
import { AccountData } from "./AccountData";
import { AccountDevices } from "./AccountDevices";
import { AccountHeader } from "./AccountHeader";
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

/** Below this width the tab menu moves from the side to a scrolling strip above the content. */
const SIDE_NAV_MIN = 640;

function tabItems(): { value: AccountTabId; label: string; icon: ReactNode }[] {
  const icon = (Icon: typeof UserRound) => <Icon className="icon-sm" aria-hidden />;
  return [
    { value: "profile", label: t("Profile"), icon: icon(UserRound) },
    { value: "security", label: t("Security"), icon: icon(Shield) },
    { value: "devices", label: t("Devices"), icon: icon(MonitorSmartphone) },
    { value: "activity", label: t("Active time"), icon: icon(Clock) },
    { value: "notifications", label: t("Notifications"), icon: icon(MessageSquare) },
    { value: "privacy", label: t("Privacy & data"), icon: icon(Lock) },
    { value: "support", label: t("Support"), icon: icon(CircleHelp) },
    { value: "status", label: t("Account status"), icon: icon(CircleAlert) },
  ];
}

/** True while the element is at least `min` pixels wide; true without ResizeObserver. */
function useWide(min: number, mountKey: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  // Keep keyboard navigation orientation aligned with the available account width.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    return observeResize(element, (entry) => setWide(entry.contentRect.width >= min));
  }, [min, mountKey]);
  return { ref, wide };
}

/**
 * The account center. Signed in it shows who is signed in above a side menu with one tab per area
 * (profile, security, devices, active time, notifications, privacy and data, support, account
 * status). Signed out it is a single sign-in panel; the rest of the app never depends on it.
 */
export function AccountScreen() {
  useLocale();
  const { state, signIn, cancelSignIn, signOut, deactivate, reactivate } = useAccount();
  const [tab, setTab] = useState<AccountTabId>("profile");
  const [visited, setVisited] = useState<{ userId: string; tabs: AccountTabId[] }>({
    userId: "",
    tabs: [],
  });
  const { ref, wide } = useWide(SIDE_NAV_MIN, state.phase);
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
    <div ref={ref} className={styles.screen} data-wide={wide || undefined}>
      <AccountHeader
        context={state.context}
        stale={state.stale}
        verifiedAt={state.verifiedAt}
        onSignOut={signOut}
      />
      {deactivated ? (
        <InlineMessage tone="warning">
          {t("Your account is deactivated. Reactivate it under Account status to use it again.")}
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
        orientation={wide ? "vertical" : "horizontal"}
      >
        <div className={styles.layout}>
          <nav className={styles.nav}>
            <TabList label={t("Account")} items={items} />
          </nav>
          <div className={styles.panel}>
            <TabPanel value="profile">
              <div className={styles.tabs}>
                <AccountProfile user={user} entitlements={state.context.entitlements} />
              </div>
            </TabPanel>
            <TabPanel value="security">
              <div className={styles.tabs}>
                <AccountSecurity user={user} onShowDevices={() => setTab("devices")} />
              </div>
            </TabPanel>
            <TabPanel value="devices">
              <div className={styles.tabs}>
                <AccountDevices currentDeviceId={state.deviceId} onSignOutThisDevice={signOut} />
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
                <AccountNotifications />
                <Divider />
                <AccountNews />
              </div>
            </TabPanel>
            <TabPanel value="privacy" keepMounted>
              <div className={styles.tabs}>
                {active === "privacy" ||
                (visited.userId === user.id && visited.tabs.includes("privacy")) ? (
                  <AccountData />
                ) : null}
              </div>
            </TabPanel>
            <TabPanel value="support" keepMounted>
              <AccountSupport />
            </TabPanel>
            <TabPanel value="status" keepMounted>
              <div className={styles.tabs}>
                <AccountStatus user={user} onDeactivate={deactivate} onReactivate={reactivate} />
              </div>
            </TabPanel>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
