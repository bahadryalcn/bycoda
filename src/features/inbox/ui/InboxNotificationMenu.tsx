import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useState } from "react";
import {
  inboxHasUnseenItems,
  inboxSeenStatus,
  knownInboxEntries,
  markInboxItemsSeen,
  retryInboxSeenStorage,
  useInboxSeenTick,
} from "../model/inboxSeen";
import { useProjectNotificationPreferences } from "../../notifications/hooks/useProjectNotificationPreferences";
import {
  isProjectMuted,
  updateNotificationPreferences,
} from "../../notifications/model/notificationPreferences";
import { useNotificationProjects } from "../../notifications/hooks/useNotificationProjects";
import { ExplorerMenu, type ExplorerMenuItem } from "../../files/ui/ExplorerMenu";
import { NotificationMuteDatePicker } from "../../notifications/ui/NotificationMuteDatePicker";
import { Popover } from "../../../shared/ui/Popover";
import {
  notificationMuteActions,
  notificationMuteDeadline,
} from "../../notifications/ui/notificationMuteActions";

/** One width for the menu and its custom mute popover. */
const INBOX_NOTIFICATION_MENU_WIDTH = 272;

type Props = {
  x: number;
  y: number;
  projectPaths: readonly string[];
  onOpenSettings?: () => void;
  onClose: () => void;
};
export function InboxNotificationMenu({ x, y, projectPaths, onOpenSettings, onClose }: Props) {
  useLocale();
  const notificationProjects = useNotificationProjects(projectPaths);
  useInboxSeenTick();
  const seenStatus = inboxSeenStatus();
  const preferences = useProjectNotificationPreferences();
  const pathsKey = JSON.stringify(projectPaths);
  // Dialog state belongs to the project set it was opened for; a different set
  // starts closed and error-free without a reset effect.
  const [local, setLocal] = useState({
    key: pathsKey,
    customOpen: false,
    error: null as string | null,
  });
  const scoped = local.key === pathsKey ? local : { key: pathsKey, customOpen: false, error: null };
  const customOpen = scoped.customOpen;
  const saveError = scoped.error;
  const setCustomOpen = (next: boolean) =>
    setLocal((previous) => ({
      ...(previous.key === pathsKey ? previous : { key: pathsKey, error: null }),
      key: pathsKey,
      customOpen: next,
    }));
  const setError = (next: string | null) =>
    setLocal((previous) => ({
      ...(previous.key === pathsKey ? previous : { customOpen: false }),
      key: pathsKey,
      error: next,
    }));
  const entries = knownInboxEntries(projectPaths);
  const hasUnread = inboxHasUnseenItems(entries);

  const allIds = notificationProjects.projects.map((project) => project.id);
  const mutedIds = allIds.filter((id) => isProjectMuted(preferences[id] ?? { disabled: [] }));
  const items: ExplorerMenuItem[] = [
    {
      kind: "item",
      id: "read-all",
      get label() {
        return t("Mark all as read");
      },
      disabled: !hasUnread,
    },
    { kind: "sep" },
    {
      kind: "item",
      id: "mute",
      get label() {
        return t("Mute all projects");
      },
      disabled: !allIds.length,
      submenu: notificationMuteActions(),
    },
    {
      kind: "item",
      id: "resume",
      get label() {
        return t("Resume muted projects");
      },
      disabled: !mutedIds.length,
    },
  ];
  if (onOpenSettings)
    items.push({
      kind: "item",
      id: "settings",
      get label() {
        return t("Notification settings…");
      },
    });

  if (customOpen)
    return (
      <Popover
        anchor={{ x, y }}
        gap={0}
        width={INBOX_NOTIFICATION_MENU_WIDTH}
        kind="dialog"
        aria-label={t("Mute project notifications")}
        onDismiss={onClose}
        variant="panel"
        className="space-y-1"
      >
        <div className="space-y-1">
          <Text as="p" size="caption" tone="secondary" weight="medium" className="px-1">
            {t("Mute all projects")}
          </Text>
        </div>
        <NotificationMuteDatePicker
          projectIds={allIds}
          onChanged={onClose}
          onCancel={() => setCustomOpen(false)}
        />
      </Popover>
    );

  return (
    <ExplorerMenu
      x={x}
      y={y}
      ariaLabel={t("Inbox actions")}
      width={INBOX_NOTIFICATION_MENU_WIDTH}
      items={items}
      onClose={onClose}
      header={
        seenStatus.state === "error" || saveError ? (
          <div className="space-y-1 px-2 py-1.5">
            {seenStatus.state === "error" ? (
              <Alert tone="danger">
                {t("Inbox read status is unavailable. Unread indicators may be incomplete.")}{" "}
                <Button variant="secondary" onClick={retryInboxSeenStorage}>
                  {t("Retry")}
                </Button>
              </Alert>
            ) : null}
            {saveError ? <Alert tone="danger">{t(saveError)}</Alert> : null}
          </div>
        ) : undefined
      }
      onPick={(id) => {
        if (id === "read-all") {
          if (!hasUnread) return;
          const applyResult = (saved: boolean) => {
            if (!saved) setError("Some read status updates may have saved. Retry to complete.");
            else onClose();
          };
          const result = markInboxItemsSeen(entries);
          if (typeof result === "boolean") applyResult(result);
          else void result.then(applyResult).catch(() => applyResult(false));
          return;
        }
        if (id === "settings") {
          onClose();
          onOpenSettings?.();
          return;
        }
        const ids = id === "resume" ? mutedIds : allIds;
        if (!ids.length) return;
        if (id === "mute:custom") {
          setCustomOpen(true);
          return;
        }
        const mutedUntil = notificationMuteDeadline(id);
        if (id !== "resume" && mutedUntil === undefined) return;
        try {
          updateNotificationPreferences(ids, {
            mutedUntil,
          });
          onClose();
        } catch {
          setError("Could not save notification preferences. Please try again.");
        }
      }}
    />
  );
}
