import { t } from "../../shared/i18n";
import {
  AppWindow,
  Archive,
  BellOff,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Internet,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Settings,
  Trash2,
} from "../../shared/ui/icons";
import type { ExternalEditor } from "../../platform/tauri/fs";
import { IS_MAC, IS_WIN } from "../../platform/tauri/platform";
import type { ProjectGroup } from "../../features/projects/model/projectGroups";
import type { TabGroupMenuExtraItem } from "../../features/workspace/ui/TabGroupMenu";
import { notificationMuteActions } from "../../features/notifications/ui/notificationMuteActions";
import { connectionIndicator } from "../../features/connections/model/remoteConnection";
import { getGroupLockView } from "../../features/group-lock/model/groupLock";
import type { ContextMenuItem } from "../../shared/ui/ContextMenu";

export const REVEAL_LABEL = IS_MAC
  ? "Reveal in Finder"
  : IS_WIN
    ? "Reveal in File Explorer"
    : "Open Containing Folder";

/** What the Machine item shows for a remote project: the machine, its connection and a status dot. */
type MachineMenuStatus = {
  description: string;
  badge: NonNullable<TabGroupMenuExtraItem["badge"]>;
};

const CONNECTION_BADGE = { connected: "success", connecting: "warning", down: "danger" } as const;

export function machineMenuStatus(
  machineName: string | undefined,
  indicator: ReturnType<typeof connectionIndicator>,
): MachineMenuStatus {
  const status =
    indicator.tone === "connected"
      ? t("Connected")
      : indicator.label === "Reconnecting"
        ? t("Reconnecting")
        : indicator.tone === "connecting"
          ? t("Connecting")
          : t("Not connected");
  return {
    description: [machineName, status].filter(Boolean).join(" · "),
    badge: { tone: CONNECTION_BADGE[indicator.tone], label: status },
  };
}

export function projectMenuExtraItems(
  pinned: boolean | null,
  canRemove: boolean,
  canConfigureNotifications: boolean,
  notificationReady: boolean,
  externalEditors: ExternalEditor[] | null,
  projectGroups: ProjectGroup[],
  canAddDirs: boolean,
  machine: MachineMenuStatus | null,
  currentProjectGroupId?: string,
  canRenameFolder = false,
): TabGroupMenuExtraItem[] {
  // A locked group is not offered as a destination.
  const lockedGroups = getGroupLockView().lock.lockedGroupIds;
  projectGroups = projectGroups.filter((group) => !lockedGroups.has(group.id));
  const groupSubmenu: ContextMenuItem[] = [
    {
      kind: "item",
      id: "project-group:new",
      get label() {
        return t("New group…");
      },
    },
    ...(projectGroups.length > 0 ? [{ kind: "sep" } as const] : []),
    ...projectGroups.map((group) => ({
      kind: "item" as const,
      id: `project-group:${group.id}`,
      label: group.name,
      checked: group.id === currentProjectGroupId,
    })),
  ];
  const items: TabGroupMenuExtraItem[] = [
    {
      id: "project-group",
      get label() {
        return t("Move to group");
      },
      icon: FolderTree,
      submenu: groupSubmenu,
    },
    ...(canAddDirs || canRenameFolder
      ? [
          {
            id: "folders",
            get label() {
              return t("Folders");
            },
            icon: FolderPlus,
            submenu: [
              ...(canRenameFolder
                ? [
                    {
                      kind: "item" as const,
                      id: "rename-folder",
                      label: t("Rename folder…"),
                      icon: <Pencil className="icon-sm" strokeWidth={1.75} />,
                    },
                  ]
                : []),
              ...(canAddDirs
                ? [
                    {
                      kind: "item" as const,
                      id: "additional-dirs",
                      label: t("Additional folders…"),
                      icon: <FolderPlus className="icon-sm" strokeWidth={1.75} />,
                    },
                  ]
                : []),
            ],
          },
        ]
      : []),
    ...(machine
      ? [
          {
            id: "machine",
            get label() {
              return t("Machine");
            },
            description: machine.description,
            icon: Internet,
            badge: machine.badge,
            submenu: [
              {
                kind: "item" as const,
                id: "reconnect-machine",
                label: t("Reconnect machine"),
                icon: <RefreshCw className="icon-sm" strokeWidth={1.75} />,
              },
              {
                kind: "item" as const,
                id: "edit-machine",
                label: t("Edit machine…"),
                icon: <Pencil className="icon-sm" strokeWidth={1.75} />,
              },
            ],
          },
        ]
      : []),
    ...(pinned == null
      ? []
      : [
          {
            id: pinned ? "unpin" : "pin",
            get label() {
              return pinned ? t("Unpin project") : t("Pin project");
            },
            icon: pinned ? PinOff : Pin,
          },
        ]),
    { id: "reveal", label: REVEAL_LABEL, icon: FolderOpen },
    {
      id: "external-editor",
      get label() {
        return t("Open in editor");
      },
      icon: AppWindow,
      disabled: externalEditors === null,
      submenu:
        externalEditors === null
          ? [
              {
                kind: "item",
                id: "external-editor:loading",
                get label() {
                  return t("Looking for editors…");
                },
                disabled: true,
              },
            ]
          : externalEditors.length > 0
            ? externalEditors.map((editor) => ({
                kind: "item" as const,
                id: `external-editor:${editor.id}`,
                label: editor.name,
              }))
            : [
                {
                  kind: "item",
                  id: "external-editor:none",
                  get label() {
                    return t("No supported editors found");
                  },
                  disabled: true,
                },
              ],
    },
    {
      id: "notifications-mute",
      get label() {
        return t("Mute notifications");
      },
      icon: BellOff,
      sepBefore: true,
      disabled: !notificationReady,
      submenu: notificationMuteActions(),
    },
  ];
  if (canConfigureNotifications) {
    items.push({
      id: "notifications-settings",
      get label() {
        return t("Notification settings…");
      },
      icon: Settings,
    });
  }
  if (canRemove) {
    items.push(
      {
        id: "archive",
        get label() {
          return t("Archive");
        },
        icon: Archive,
        sepBefore: true,
      },
      {
        id: "delete",
        get label() {
          return t("Delete");
        },
        icon: Trash2,
        danger: true,
      },
    );
  }
  return items;
}
