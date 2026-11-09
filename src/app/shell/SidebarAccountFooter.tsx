import { AccountMenu, useAccount } from "../../features/account";
import { useAssistantPresence } from "../../features/assistant/hooks/useAssistantPresence";
import { AssistantPresenceIndicator } from "../../features/assistant/ui/AssistantPresenceIndicator";
import { useKeybindingShortcut } from "../../features/settings/model/useKeybindingShortcut";
import { VoiceLauncherSlot } from "../../features/voice/ui/companion/voiceLauncherSlot";
import { useT } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { Settings } from "../../shared/ui/icons";
import { SidebarUpdateFooter } from "./SidebarUpdate";

/**
 * Bottom of the sidebar: account (avatar with availability dot), Settings and the docked voice
 * companion on the left, the update icon (only while an update waits) on the right. Feedback and the GitHub project links live
 * in the account menu and Settings. `compact` stacks account, Settings and the update icon for the
 * narrow rail.
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
  if (compact)
    return (
      <div
        data-sidebar-account-footer="compact"
        className="flex w-full shrink-0 flex-col items-center gap-1 py-1.5"
      >
        {account}
        {settings}
        <VoiceLauncherSlot compact />
        <SidebarUpdateFooter icon />
      </div>
    );
  return (
    <div
      data-sidebar-account-footer
      className="flex shrink-0 items-center justify-between gap-1 p-2"
    >
      <div className="flex min-w-0 items-center gap-1">
        {account}
        {settings}
        <VoiceLauncherSlot />
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <SidebarUpdateFooter icon />
      </div>
    </div>
  );
}
