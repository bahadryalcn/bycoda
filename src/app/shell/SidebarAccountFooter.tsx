import type { ReactNode } from "react";
import { surfaceAttributes } from "../../shared/ui/Surface";
import { AccountMenu, useAccount } from "../../features/account";
import { useAssistantPresence } from "../../features/assistant/hooks/useAssistantPresence";
import { AssistantPresenceIndicator } from "../../features/assistant/ui/AssistantPresenceIndicator";
import { useKeybindingShortcut } from "../../features/settings/model/useKeybindingShortcut";
import { VoiceLauncherSlot } from "../../features/voice/ui/companion/voiceLauncherSlot";
import { useT } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { Settings } from "../../shared/ui/icons";
import { SidebarUpdateFooter } from "./SidebarUpdate";
import styles from "./SidebarAccountFooter.module.css";

/**
 * Voice first, repository/update actions next, then Settings and account at the edge.
 * `compact` preserves the same order vertically within the existing narrow rail.
 */
export function SidebarAccountFooter({
  compact = false,
  updateNotice,
  recoveryControl,
  notificationTriggerRef,
  onOpenSettings,
  onOpenAccountSettings,
}: {
  compact?: boolean;
  updateNotice?: ReactNode;
  recoveryControl?: ReactNode;
  notificationTriggerRef?: (element: HTMLSpanElement | null) => void;
  onOpenSettings?: () => void;
  onOpenAccountSettings?: () => void;
}) {
  const t = useT();
  const { state, signIn, signOut } = useAccount();
  const presence = useAssistantPresence();
  const settingsShortcut = useKeybindingShortcut("App: Settings");
  const account = (
    <AccountMenu
      state={state}
      presence={{
        hidden: presence.hidden,
        items: presence.items,
        begin: () => presence.begin().catch(() => undefined),
        end: presence.end,
        pick: presence.pick,
        badge: <AssistantPresenceIndicator state={presence.state} markOnly />,
        summary: presence.label,
      }}
      onSignIn={() => void signIn().catch(() => undefined)}
      onSignOut={() => void signOut().catch(() => undefined)}
      onOpenAccountSettings={() => onOpenAccountSettings?.()}
    />
  );
  const settings = (
    <Button
      iconOnly
      variant="ghost"
      motion="none"
      label={t("Settings")}
      shortcut={settingsShortcut}
      tooltipSide={compact ? "right" : "top"}
      onClick={onOpenSettings}
      disabled={!onOpenSettings}
      disabledReason={!onOpenSettings ? t("Not available yet.") : undefined}
    >
      <Settings className="icon-md" aria-hidden />
    </Button>
  );
  return (
    <div data-sidebar-account-footer={compact ? "compact" : ""} className={styles.footer}>
      <div className={styles.actions}>
        <VoiceLauncherSlot compact={compact} />
        <div className={styles.status}>
          {recoveryControl}
          <div className={styles.updateNotice}>{updateNotice}</div>
          <div className={styles.updateAction}>
            <SidebarUpdateFooter icon compact={compact} />
          </div>
        </div>
        <div {...surfaceAttributes(compact ? { frame: "pane", edge: "top" } : {}, styles.personal)}>
          {notificationTriggerRef ? (
            <span className="inline-flex" ref={notificationTriggerRef} />
          ) : null}
          {settings}
          {account}
        </div>
      </div>
    </div>
  );
}
