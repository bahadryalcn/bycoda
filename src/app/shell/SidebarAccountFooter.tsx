import { AccountMenu, useAccount } from "../../features/account";
import { useAssistantPresence } from "../../features/assistant/hooks/useAssistantPresence";
import { AssistantPresenceIndicator } from "../../features/assistant/ui/AssistantPresenceIndicator";
import { useKeybindingShortcut } from "../../features/settings/model/useKeybindingShortcut";
import { VoiceLauncherSlot } from "../../features/voice/ui/companion/voiceLauncherSlot";
import { useT } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { Badge } from "../../shared/ui/Badge";
import { Tooltip } from "../../shared/ui/Tooltip";
import { Settings, Wrench } from "../../shared/ui/icons";
import { SidebarUpdateFooter } from "./SidebarUpdate";
import styles from "./SidebarAccountFooter.module.css";

/**
 * Voice first, repository/update actions next, then Settings and account at the edge.
 * `compact` preserves the same order vertically within the existing narrow rail.
 */
export function SidebarAccountFooter({
  compact = false,
  onOpenSettings,
  onOpenAccountSettings,
}: {
  compact?: boolean;
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
    >
      <Settings className="icon-md" aria-hidden />
    </Button>
  );
  return (
    <div data-sidebar-account-footer={compact ? "compact" : ""} className={styles.footer}>
      <VoiceLauncherSlot compact={compact} />
      <div className={styles.actions}>
        {import.meta.env.DEV ? (
          <Tooltip label={t("Development build")} side={compact ? "right" : "top"}>
            <Badge
              data-dev-mode-indicator=""
              size="sm"
              tone="info"
              appearance="subtle"
              role="img"
              aria-label={t("Development build")}
            >
              <Wrench className="icon-sm" strokeWidth={1.75} aria-hidden />
            </Badge>
          </Tooltip>
        ) : null}
        <SidebarUpdateFooter repositoryPrompt icon compact={compact} />
        <div className={styles.personal}>
          {settings}
          {account}
        </div>
      </div>
    </div>
  );
}
