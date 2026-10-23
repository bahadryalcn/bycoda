import { Alert } from "../../shared/ui/Alert";
import { t, useT } from "../../shared/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AppWindow,
  Archive,
  ArrowDownCircle,
  ArrowUp,
  BellOff,
  CheckList,
  ChevronDown,
  ExternalLink,
  EyeOff,
  FolderOpen,
  FolderPlus,
  FolderTree,
  ImagePlus,
  Lock,
  LockOpen,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Settings,
  Ungroup,
  Trash2,
} from "../../shared/ui/icons";
import {
  basename,
  listExternalEditors,
  openInExternalEditor,
  openPathWithDefaultApp,
  revealPath,
  type ExternalEditor,
} from "../../platform/tauri/fs";
import { IS_MAC, IS_WIN } from "../../platform/tauri/platform";
import { projectKey, projectName } from "../../shared/lib/paths";
import {
  collectRailProjects,
  loadPinnedProjects,
  loadRecents,
  sameProjectPath,
  subscribeProjectPathsChanged,
  toggleProjectPin,
} from "../../features/projects/model/recents";
import {
  loadTabGroupColors,
  loadRailBackgrounds,
  saveRailBackgrounds,
  loadTabGroupCustomColors,
  loadTabGroupLabels,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupColorIndex,
  resolveTabGroupCustomColor,
  resolveTabGroupLabel,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
  saveTabGroupColor,
  saveTabGroupCustomColor,
  saveTabGroupLabel,
  saveTabGroupMascot,
} from "../../features/workspace/model/tabGroups";
import {
  createProjectGroup,
  deleteProjectGroup,
  loadProjectGroupAssignments,
  loadProjectGroups,
  moveProjectGroup,
  projectGroupColor,
  projectGroupIdForPath,
  projectGroupParentId,
  projectGroupWorkspaceRoot,
  saveProjectGroups,
  setProjectGroupAssignment,
  unlinkProjectGroup,
  updateProjectGroup,
  type ProjectGroup,
} from "../../features/projects/model/projectGroups";
import { REFRESH_LINKED_GROUP_EVENT } from "../../features/projects/hooks/useLinkedWorkspaceGroups";
import { GroupFetchPopover } from "../../features/projects/ui/GroupFetchPopover";
import { setLinkedGroupStatus } from "../../features/projects/model/linkedWorkspace";
import { useTabGroupLogos } from "../../features/projects/hooks/useTabGroupLogos";
import { ProjectBackgroundDialog } from "../../features/projects/ui/ProjectBackgroundDialog";
import { RemoveProjectDialog } from "../../features/projects/ui/RemoveProjectDialog";
import { AdditionalDirsDialog } from "../../features/projects/ui/AdditionalDirsDialog";
import { RenameProjectFolderDialog } from "../../features/projects/ui/RenameProjectFolderDialog";
import { isLocalProject, isRemoteProjectPath } from "../../features/projects/model/recents";
import { projectNameError } from "../../features/projects/model/projectNames";
import { TabGroupMenu, type TabGroupMenuExtraItem } from "../../features/workspace/ui/TabGroupMenu";
import {
  knownNotificationProject,
  type NotificationProject,
} from "../../features/notifications/model/notificationProjects";
import { NotificationMuteDatePicker } from "../../features/notifications/ui/NotificationMuteDatePicker";
import { Popover } from "../../shared/ui/Popover";
import {
  notificationMuteActions,
  notificationMuteDeadline,
  notificationMuteStatus,
} from "../../features/notifications/ui/notificationMuteActions";
import { useProjectNotificationPreferences } from "../../features/notifications/hooks/useProjectNotificationPreferences";
import { reconnectRemoteMachine } from "../../features/connections/model/remoteReconnect";
import { remoteProjectFor } from "../../features/connections/model/remoteProjects";
import {
  knownRemoteMachine,
  requestMachineEdit,
} from "../../features/connections/model/connections";
import { useNotificationProjects } from "../../features/notifications/hooks/useNotificationProjects";
import { updateNotificationPreferences } from "../../features/notifications/model/notificationPreferences";
import type { ExplorerMenuItem } from "../../features/files/ui/ExplorerMenu";
import { useGroupLock } from "../../features/group-lock/hooks/useGroupLock";
import {
  getGroupLockView,
  hideGroup,
  lockGroup,
  makeGroupLockable,
  removeGroupLock,
} from "../../features/group-lock/model/groupLock";
import { PasswordPromptDialog } from "../../features/group-lock/ui/PasswordPromptDialog";
import { SetLockPasswordDialog } from "../../features/group-lock/ui/SetLockPasswordDialog";
import { UnlockGroupDialog } from "../../features/group-lock/ui/UnlockGroupDialog";

const REVEAL_LABEL = IS_MAC
  ? "Reveal in Finder"
  : IS_WIN
    ? "Reveal in File Explorer"
    : "Open Containing Folder";

function projectMenuExtraItems(
  pinned: boolean,
  canRemove: boolean,
  canConfigureNotifications: boolean,
  notificationReady: boolean,
  externalEditors: ExternalEditor[] | null,
  projectGroups: ProjectGroup[],
  canAddDirs: boolean,
  canReconnect: boolean,
  currentProjectGroupId?: string,
  canRenameFolder = false,
): TabGroupMenuExtraItem[] {
  // A locked group is not offered as a destination.
  const lockedGroups = getGroupLockView().lock.lockedGroupIds;
  projectGroups = projectGroups.filter((group) => !lockedGroups.has(group.id));
  const groupSubmenu: ExplorerMenuItem[] = [
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
    ...(projectGroups.length > 0 ? [{ kind: "sep" } as const] : []),
    {
      kind: "item",
      id: "project-group:none",
      get label() {
        return t("Ungrouped");
      },
      checked: currentProjectGroupId == null,
    },
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
                      icon: <Pencil className="size-3.5" strokeWidth={1.75} />,
                    },
                  ]
                : []),
              ...(canAddDirs
                ? [
                    {
                      kind: "item" as const,
                      id: "additional-dirs",
                      label: t("Additional folders…"),
                      icon: <FolderPlus className="size-3.5" strokeWidth={1.75} />,
                    },
                  ]
                : []),
            ],
          },
        ]
      : []),
    ...(canReconnect
      ? [
          {
            id: "reconnect-machine",
            get label() {
              return t("Reconnect machine");
            },
            icon: RefreshCw,
          },
          {
            id: "edit-machine",
            get label() {
              return t("Edit machine…");
            },
            icon: Pencil,
          },
        ]
      : []),
    pinned
      ? {
          id: "unpin",
          get label() {
            return t("Unpin project");
          },
          icon: PinOff,
        }
      : {
          id: "pin",
          get label() {
            return t("Pin project");
          },
          icon: Pin,
        },
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

type Point = { x: number; y: number };

type Options = {
  onRenameProjectFolder?: (path: string, name: string) => Promise<void>;
  onRemoveProject?: (path: string, options: { purgeData: boolean }) => void | Promise<void>;
  onOpenNotificationSettings?: (projectPath?: string) => void;
  /** Offers "Add project to group…" in the group menu. */
  onAddProjectToGroup?: (groupId: string) => void;
  /** Called when a project or group menu opens, so hosts can close sibling menus. */
  onOpen?: () => void;
  projectPaths?: string[];
  activeProject?: string;
  isProjectBusy?: (path: string) => boolean;
};

/**
 * Right-click menu for a project: appearance, groups, pinning, editors,
 * notifications, and removal. Shared by the project rail and the project
 * pickers shown while the rail is hidden. Every change lands in storage,
 * which announces it through `subscribeProjectPathsChanged`.
 */
export function useProjectMenu({
  onRenameProjectFolder,
  onRemoveProject,
  onOpenNotificationSettings,
  onAddProjectToGroup,
  onOpen,
  projectPaths,
  activeProject,
  isProjectBusy,
}: Options) {
  const t = useT();
  const [projectMenu, setProjectMenu] = useState<
    (Point & { path: string; projectKey: string; onSelectForBulk?: () => void }) | null
  >(null);
  const [removingGroup, setRemovingGroup] = useState<{
    id: string;
    name: string;
    paths: string[];
  } | null>(null);
  const removalContext = useRef({ projectPaths, activeProject, isProjectBusy, onRemoveProject });
  removalContext.current = { projectPaths, activeProject, isProjectBusy, onRemoveProject };
  const pathsForGroup = (id: string) => {
    const assignments = loadProjectGroupAssignments();
    return [
      ...new Set(
        projectPaths ??
          [...collectRailProjects(loadRecents(), activeProject ?? "").values()].map(
            (project) => project.path,
          ),
      ),
    ].filter((path) => projectGroupIdForPath(path, assignments) === id);
  };
  const groupRemovalValid = (group: { id: string; paths: string[] }) => {
    const current = pathsForGroup(group.id);
    return (
      !!onRemoveProject &&
      loadProjectGroups().some((entry) => entry.id === group.id) &&
      !getGroupLockView().lock.lockedGroupIds.has(group.id) &&
      current.length === group.paths.length &&
      group.paths.every(
        (path) => current.some((entry) => sameProjectPath(path, entry)) && !isProjectBusy?.(path),
      )
    );
  };
  const [groupMenu, setGroupMenu] = useState<(Point & { id: string }) | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [fetchAll, setFetchAll] = useState<(Point & { id: string; paths: string[] }) | null>(null);
  const [notificationMenu, setNotificationMenu] = useState<
    (Point & { path: string; project: NotificationProject }) | null
  >(null);
  const [removing, setRemoving] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const [backgroundProject, setBackgroundProject] = useState<{
    project: string;
    name: string;
  } | null>(null);
  const [additionalDirsProject, setAdditionalDirsProject] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const [lockDialog, setLockDialog] = useState<
    | { kind: "unlock" | "remove-lock"; groupId: string; name: string }
    | { kind: "set"; groupId: string; lockNow: boolean }
    | null
  >(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [externalEditors, setExternalEditors] = useState<ExternalEditor[] | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  // The menus render straight from storage; re-render when it changes.
  const [, setStorageRevision] = useState(0);
  useEffect(
    () => subscribeProjectPathsChanged(() => setStorageRevision((revision) => revision + 1)),
    [],
  );
  const groupLogos = useTabGroupLogos();
  // Group menus and the lock dialogs follow lock changes, not just storage.
  useGroupLock();
  const notificationPreferences = useProjectNotificationPreferences();
  const menuPath = projectMenu?.path;
  useNotificationProjects(menuPath ? [menuPath] : []);
  const readyNotificationProject = menuPath ? knownNotificationProject(menuPath) : undefined;
  const menuMuteStatus = readyNotificationProject
    ? notificationMuteStatus(notificationPreferences[readyNotificationProject.id])
    : null;

  useEffect(() => {
    setMenuError(null);
  }, [menuPath]);

  useEffect(() => {
    let active = true;
    void listExternalEditors()
      .then((installed) => {
        if (active) setExternalEditors(Array.isArray(installed) ? installed : []);
      })
      .catch(() => {
        if (active) setExternalEditors([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const captureTrigger = (element?: HTMLElement | null) => {
    trigger.current =
      element ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  };

  const restoreFocus = () => trigger.current?.focus();

  const closeNotificationMenu = () => {
    setNotificationMenu(null);
    restoreFocus();
  };

  const open = (
    path: string,
    x: number,
    y: number,
    triggerElement?: HTMLElement | null,
    onSelectForBulk?: () => void,
  ) => {
    captureTrigger(triggerElement);
    onOpen?.();
    setGroupMenu(null);
    setNotificationMenu(null);
    setProjectMenu({ x, y, path, projectKey: projectKey(path), onSelectForBulk });
  };

  const openGroupMenu = (id: string, x: number, y: number) => {
    captureTrigger();
    onOpen?.();
    setProjectMenu(null);
    setNotificationMenu(null);
    setFetchAll(null);
    setGroupMenu({ x, y, id });
  };

  const createGroup = (x: number, y: number, projectPath?: string) => {
    const current = loadProjectGroups();
    const group = createProjectGroup(current);
    if (!saveProjectGroups([...current, group])) return;
    if (projectPath) setProjectGroupAssignment(projectPath, group.id);
    else captureTrigger();
    setGroupMenu({ x, y, id: group.id });
  };

  const close = () => {
    setProjectMenu(null);
    setGroupMenu(null);
    setNotificationMenu(null);
  };

  const dismiss = () => {
    close();
    setFetchAll(null);
    setRemoving(null);
    setBackgroundProject(null);
    setLockDialog(null);
    setRenamingFolder(null);
  };

  const groupNamed = (groupId: string) =>
    loadProjectGroups().find((group) => group.id === groupId)?.name ?? "group";

  const requestUnlock = (groupId: string) => {
    captureTrigger();
    setLockDialog({ kind: "unlock", groupId, name: groupNamed(groupId) });
  };

  /** Marks the group lockable, asking for a first password when there is none. */
  const makeLockable = (groupId: string, lockNow: boolean) => {
    if (!getGroupLockView().hasPassword) {
      captureTrigger();
      setLockDialog({ kind: "set", groupId, lockNow });
      return;
    }
    makeGroupLockable(groupId);
    if (lockNow) lockGroup(groupId);
  };

  /** The padlock on a group header: lock an open group, ask to open a locked one. */
  const toggleGroupLock = (groupId: string) => {
    if (getGroupLockView().lock.lockedGroupIds.has(groupId)) {
      requestUnlock(groupId);
    } else {
      makeLockable(groupId, true);
    }
  };

  const groupLabels = projectMenu ? loadTabGroupLabels() : {};

  const onPick = (action: string) => {
    if (!projectMenu) return;
    const { path, projectKey: key } = projectMenu;
    if (action === "rename-folder") {
      setRenamingFolder(path);
      return;
    }
    if (action === "select-for-bulk") {
      projectMenu.onSelectForBulk?.();
    } else if (action === "project-group:new") {
      createGroup(projectMenu.x, projectMenu.y, path);
    } else if (action === "project-group:none") {
      setProjectGroupAssignment(path, null);
    } else if (action.startsWith("project-group:")) {
      setProjectGroupAssignment(path, action.slice("project-group:".length));
    } else if (action === "mute:custom") {
      if (!readyNotificationProject) return false;
      setNotificationMenu({
        ...projectMenu,
        project: readyNotificationProject,
      });
    } else if (action.startsWith("mute:") || action === "notifications-resume") {
      if (!readyNotificationProject) return false;
      const mutedUntil = notificationMuteDeadline(action);
      if (action !== "notifications-resume" && mutedUntil === undefined) return false;
      try {
        updateNotificationPreferences([readyNotificationProject.id], {
          mutedUntil,
        });
      } catch {
        setMenuError("Could not save notification preferences. Please try again.");
        return false;
      }
    } else if (action.startsWith("external-editor:")) {
      const editorId = action.slice("external-editor:".length);
      if (!externalEditors?.some((editor) => editor.id === editorId)) return false;
      void openInExternalEditor(editorId, path)
        .then(() => {
          setProjectMenu(null);
          restoreFocus();
        })
        .catch((error: unknown) => {
          setMenuError(error instanceof Error ? error.message : String(error));
        });
      return false;
    } else if (action === "notifications-settings") {
      onOpenNotificationSettings?.(path);
    } else if (action === "reconnect-machine") {
      const remote = remoteProjectFor(path);
      if (remote) void reconnectRemoteMachine(remote.environmentId, { signIn: true });
    } else if (action === "edit-machine") {
      const remote = remoteProjectFor(path);
      const machine = remote ? knownRemoteMachine(remote.environmentId) : undefined;
      if (machine?.ssh) requestMachineEdit(machine.id);
    } else if (action === "pin" || action === "unpin") {
      toggleProjectPin(path);
    } else if (action === "background") {
      setBackgroundProject({
        project: key,
        name: resolveTabGroupLabel(key, groupLabels, basename(path)),
      });
    } else if (action === "additional-dirs") {
      setAdditionalDirsProject({
        path,
        name: resolveTabGroupLabel(key, groupLabels, basename(path)),
      });
    } else if (action === "reveal") void revealPath(path);
    else if (action === "archive") {
      void Promise.resolve()
        .then(() => onRemoveProject?.(path, { purgeData: false }))
        .then(() => {
          setProjectMenu(null);
          restoreFocus();
        })
        .catch((error: unknown) =>
          setMenuError(error instanceof Error ? error.message : String(error)),
        );
      return false;
    } else if (action === "delete") {
      setRemoving({
        path,
        name: resolveTabGroupLabel(key, groupLabels, basename(path)),
      });
    }
  };

  const renderProjectMenu = () => {
    if (!projectMenu) return null;
    const key = projectMenu.projectKey;
    const colors = loadTabGroupColors();
    const customColors = loadTabGroupCustomColors();
    const label = resolveTabGroupLabel(key, groupLabels, basename(projectMenu.path));
    return (
      <TabGroupMenu
        x={projectMenu.x}
        y={projectMenu.y}
        groupId={key}
        railBackgrounds={loadRailBackgrounds(key)}
        onRailBackgroundChange={(value) => saveRailBackgrounds(key, value)}
        label={label}
        colorIndex={resolveTabGroupColorIndex(key, colors, customColors)}
        customColor={resolveTabGroupCustomColor(key, customColors)}
        currentColor={resolveTabGroupColor(
          key,
          colors,
          customColors,
          projectName(projectMenu.path),
        )}
        logoPath={resolveTabGroupLogo(key, groupLogos)}
        logoProject={projectMenu.path}
        mascotName={resolveTabGroupMascot(key, loadTabGroupMascots())}
        mascotProject={projectName(projectMenu.path)}
        // An untouched name is not saved: that would turn the folder name, or
        // an automatic name, into a label that syncs.
        onRename={(project, name) => {
          if (name !== label) saveTabGroupLabel(project, name);
        }}
        validateName={(name) => projectNameError(projectMenu.path, name)}
        onColorChange={saveTabGroupColor}
        onCustomColorChange={saveTabGroupCustomColor}
        onMascotChange={saveTabGroupMascot}
        onLogoChange={() => {}}
        onPick={() => {}}
        onClose={() => {
          setProjectMenu(null);
          restoreFocus();
        }}
        showActions={false}
        compactAppearance
        appearanceItems={[{ id: "background", label: t("Background image"), icon: ImagePlus }]}
        leadingAction={
          menuMuteStatus
            ? {
                id: "notifications-resume",
                get label() {
                  return t("Resume notifications");
                },
                description: menuMuteStatus,
                icon: BellOff,
              }
            : undefined
        }
        extraItems={[
          ...(projectMenu.onSelectForBulk
            ? [{ id: "select-for-bulk", label: t("Select"), icon: CheckList }]
            : []),
          ...projectMenuExtraItems(
            loadPinnedProjects().some((pinned) => sameProjectPath(pinned, projectMenu.path)),
            Boolean(onRemoveProject),
            Boolean(onOpenNotificationSettings),
            Boolean(readyNotificationProject),
            externalEditors,
            loadProjectGroups(),
            isLocalProject(projectMenu.path),
            Boolean(remoteProjectFor(projectMenu.path)),
            projectGroupIdForPath(projectMenu.path, loadProjectGroupAssignments()),
            Boolean(onRenameProjectFolder && isLocalProject(projectMenu.path)),
          ),
        ]}
        footer={
          menuError ? (
            <Alert tone="danger" role="alert">
              {menuError}
            </Alert>
          ) : null
        }
        onExtraPick={onPick}
      />
    );
  };

  const renderGroupMenu = () => {
    if (!groupMenu) return null;
    const group = loadProjectGroups().find((item) => item.id === groupMenu.id);
    if (!group) return null;
    const locked = getGroupLockView().lock.lockedGroupIds.has(group.id);
    const workspaceRoot = projectGroupWorkspaceRoot(group);
    const parentId = projectGroupParentId(
      group,
      loadProjectGroups(),
      loadProjectGroupAssignments(),
    );
    const workspaceDestinations = loadProjectGroups().filter(
      (item) => !item.workspaceFile && !getGroupLockView().lock.lockedGroupIds.has(item.id),
    );
    const lockItems: TabGroupMenuExtraItem[] = locked
      ? [
          {
            id: "unlock-group",
            get label() {
              return t("Unlock…");
            },
            icon: LockOpen,
          },
          {
            id: "remove-group-lock",
            get label() {
              return t("Remove lock…");
            },
            icon: Lock,
          },
        ]
      : group.lockable
        ? [
            {
              id: "lock-group",
              get label() {
                return t("Lock group");
              },
              icon: Lock,
            },
            {
              id: "remove-group-lock",
              get label() {
                return t("Remove lock…");
              },
              icon: Lock,
            },
          ]
        : [
            {
              id: "lock-group",
              get label() {
                return t("Lock group");
              },
              icon: Lock,
            },
            {
              id: "make-lockable",
              get label() {
                return t("Make lockable");
              },
              get description() {
                return t("Ask for the password once it is locked");
              },
              icon: Lock,
            },
          ];
    // Reordering reveals nothing, so a locked group can still be moved.
    const groupIds = loadProjectGroups().map((item) => item.id);
    const groupIndex = groupIds.indexOf(group.id);
    const moveItems: TabGroupMenuExtraItem[] = [
      {
        id: "move-group-up",
        get label() {
          return t("Move up");
        },
        icon: ArrowUp,
        disabled: groupIndex <= 0,
      },
      {
        id: "move-group-down",
        get label() {
          return t("Move down");
        },
        icon: ChevronDown,
        disabled: groupIndex >= groupIds.length - 1,
      },
      {
        id: "move-group-top",
        get label() {
          return t("Move to top");
        },
        icon: ArrowUp,
        disabled: groupIndex <= 0,
      },
    ];
    // A locked group offers nothing that would touch or reveal its projects.
    const groupItems: TabGroupMenuExtraItem[] = locked
      ? []
      : [
          ...(onAddProjectToGroup
            ? [
                {
                  id: "add-project-to-group",
                  get label() {
                    return t("Add project to group…");
                  },
                  icon: FolderPlus,
                },
              ]
            : []),
          ...(group.workspaceFile
            ? [
                {
                  id: "workspace-refresh",
                  get label() {
                    return t("Refresh from workspace file");
                  },
                  description: group.workspaceFile,
                  icon: RefreshCw,
                },
                {
                  id: "workspace-open",
                  get label() {
                    return t("Open workspace file");
                  },
                  icon: ExternalLink,
                },
                {
                  id: "workspace-reveal",
                  label: REVEAL_LABEL,
                  icon: FolderOpen,
                },
                {
                  id: "workspace-unlink",
                  get label() {
                    return t("Unlink from workspace file");
                  },
                  get description() {
                    return t("Projects stay in the group");
                  },
                  icon: Ungroup,
                },
              ]
            : []),
          {
            id: "fetch-all",
            get label() {
              return t("Fetch all");
            },
            get description() {
              return t("Run git fetch in each project");
            },
            icon: ArrowDownCircle,
            sepBefore: true,
          },
          {
            id: "delete-project-group",
            get label() {
              return t("Delete group");
            },
            get description() {
              return t("Projects will become ungrouped");
            },
            icon: Trash2,
            danger: true,
          },
        ];
    const branch = (
      id: string,
      label: string,
      icon: TabGroupMenuExtraItem["icon"],
      items: TabGroupMenuExtraItem[],
    ): TabGroupMenuExtraItem => ({
      id,
      label,
      icon,
      submenu: items.flatMap((item) => [
        ...(item.sepBefore ? [{ kind: "sep" as const }] : []),
        {
          kind: "item" as const,
          ...item,
          icon: <item.icon className="size-3.5" strokeWidth={1.75} />,
        },
      ]),
    });
    const privacyItems: TabGroupMenuExtraItem[] = [
      {
        id: "hide-group",
        label: t("Hide group"),
        description: t("Restore from Settings → Group privacy → Hidden groups"),
        icon: EyeOff,
      },
      ...lockItems.filter((item) => item.id !== "lock-group" && item.id !== "unlock-group"),
    ];
    const deleteItems = groupItems.filter((item) => item.id === "delete-project-group");
    if (!locked)
      deleteItems.push({
        id: "delete-group-with-projects",
        label: t("Delete group with projects"),
        description: t("Projects and saved conversations will be removed. Folders stay on disk."),
        icon: Trash2,
        danger: true,
        disabled: !onRemoveProject || pathsForGroup(group.id).some((path) => isProjectBusy?.(path)),
      });
    return (
      <TabGroupMenu
        x={groupMenu.x}
        y={groupMenu.y}
        groupId={group.id}
        railBackgrounds={loadRailBackgrounds(group.id)}
        onRailBackgroundChange={(value) => saveRailBackgrounds(group.id, value)}
        groupBackground
        label={group.name}
        colorIndex={group.colorIndex ?? null}
        customColor={group.customColor ?? null}
        currentColor={projectGroupColor(group)}
        logoPath={null}
        mascotName={group.mascot ?? null}
        mascotProject={group.id}
        onRename={(_, name) =>
          updateProjectGroup(group.id, (current) => ({
            ...current,
            name: name.trim() || current.name,
          }))
        }
        onColorChange={(_, colorIndex) =>
          updateProjectGroup(group.id, (current) => ({
            ...current,
            colorIndex: colorIndex ?? undefined,
            customColor: undefined,
          }))
        }
        onCustomColorChange={(_, customColor) =>
          updateProjectGroup(group.id, (current) => ({
            ...current,
            colorIndex: undefined,
            customColor,
          }))
        }
        onMascotChange={(_, mascot) =>
          updateProjectGroup(group.id, (current) => ({
            ...current,
            mascot: mascot ?? undefined,
          }))
        }
        onLogoChange={() => {}}
        onPick={() => {}}
        onClose={() => {
          setGroupMenu(null);
          restoreFocus();
        }}
        showActions={false}
        ariaLabel="Project group actions"
        footer={
          menuError ? (
            <Alert tone="danger" role="alert">
              {menuError}
            </Alert>
          ) : undefined
        }
        compactAppearance
        extraItems={[
          ...(workspaceRoot && !locked
            ? [
                {
                  id: "workspace-parent",
                  label: t("Move to group"),
                  icon: FolderPlus,
                  submenu: [
                    { kind: "item" as const, id: "workspace-parent:new", label: t("New group…") },
                    { kind: "sep" as const },
                    ...workspaceDestinations.map((item) => ({
                      kind: "item" as const,
                      id: `workspace-parent:${item.id}`,
                      label: item.name,
                      checked: item.id === parentId,
                    })),
                    ...(workspaceDestinations.length ? [{ kind: "sep" as const }] : []),
                    {
                      kind: "item" as const,
                      id: "workspace-parent:none",
                      label: t("Ungrouped"),
                      checked: !parentId,
                    },
                  ],
                },
              ]
            : []),
          branch("order", t("Reorder group"), ArrowUp, moveItems),
          ...lockItems.filter((item) => item.id === "lock-group" || item.id === "unlock-group"),
          branch("privacy", t("Group privacy"), Lock, privacyItems),
          ...groupItems.filter((item) => item.id === "add-project-to-group"),
          ...(group.workspaceFile && !locked
            ? [
                branch(
                  "workspace",
                  t("Workspace file"),
                  FolderOpen,
                  groupItems.filter((item) => item.id.startsWith("workspace-")),
                ),
              ]
            : []),
          ...groupItems.filter((item) => item.id === "fetch-all"),
          ...(!locked
            ? [
                {
                  ...branch("delete", t("Delete"), Trash2, deleteItems),
                  danger: true,
                  sepBefore: true,
                },
              ]
            : []),
        ]}
        onExtraPick={(action) => {
          const file = group.workspaceFile;
          if (action.startsWith("workspace-parent:") && workspaceRoot && !locked) {
            const targetId = action.slice("workspace-parent:".length);
            const currentLock = getGroupLockView().lock;
            if (currentLock.lockedGroupIds.has(group.id)) return false;
            if (targetId === "new") {
              createGroup(groupMenu.x, groupMenu.y, workspaceRoot);
              return false;
            }
            if (
              targetId !== "none" &&
              !loadProjectGroups().some(
                (item) =>
                  item.id === targetId &&
                  !item.workspaceFile &&
                  !currentLock.lockedGroupIds.has(item.id),
              )
            )
              return false;
            setProjectGroupAssignment(workspaceRoot, targetId === "none" ? null : targetId);
            if (targetId !== "none")
              updateProjectGroup(targetId, (current) => ({ ...current, collapsed: false }));
            return;
          }
          if (action === "hide-group") {
            if (!hideGroup(group.id)) {
              setMenuError("Could not save group visibility. Please try again.");
              return false;
            }
            captureTrigger(
              document.querySelector<HTMLElement>('button[aria-label="Manage hidden groups"]'),
            );
            return;
          }
          if (action.startsWith("move-group-")) {
            moveProjectGroup(
              group.id,
              action === "move-group-up" ? "up" : action === "move-group-down" ? "down" : "top",
            );
            return;
          }
          if (action === "unlock-group") {
            requestUnlock(group.id);
            return;
          }
          if (action === "lock-group") {
            toggleGroupLock(group.id);
            return;
          }
          if (action === "make-lockable") {
            makeLockable(group.id, false);
            return;
          }
          if (action === "remove-group-lock") {
            captureTrigger();
            setLockDialog({
              kind: "remove-lock",
              groupId: group.id,
              name: group.name,
            });
            return;
          }
          if (locked) return;
          if (action === "delete-group-with-projects") {
            const paths = pathsForGroup(group.id);
            if (!groupRemovalValid({ id: group.id, paths })) return false;
            setRemovingGroup({ id: group.id, name: group.name, paths });
            return;
          }
          if (action === "delete-project-group") {
            return deleteProjectGroup(group.id);
          }
          if (action === "add-project-to-group") {
            onAddProjectToGroup?.(group.id);
            return;
          }
          if (action === "fetch-all") {
            const assignments = loadProjectGroupAssignments();
            setFetchAll({
              x: groupMenu.x,
              y: groupMenu.y,
              id: group.id,
              paths: [...collectRailProjects(loadRecents(), "").values()]
                .map((project) => project.path)
                .filter(
                  (path) =>
                    (isLocalProject(path) || isRemoteProjectPath(path)) &&
                    projectGroupIdForPath(path, assignments) === group.id,
                ),
            });
          } else if (action === "workspace-refresh") {
            window.dispatchEvent(new CustomEvent(REFRESH_LINKED_GROUP_EVENT, { detail: group.id }));
          } else if (action === "workspace-open" && file) {
            void openPathWithDefaultApp(file).catch(() => undefined);
          } else if (action === "workspace-reveal" && file) {
            void revealPath(file).catch(() => undefined);
          } else if (action === "workspace-unlink") {
            unlinkProjectGroup(group.id);
            setLinkedGroupStatus(group.id, null);
          }
        }}
      />
    );
  };

  const element: ReactNode = (
    <>
      {renderProjectMenu()}
      {renderGroupMenu()}
      {renamingFolder && onRenameProjectFolder ? (
        <RenameProjectFolderDialog
          path={renamingFolder}
          onRename={(name) => onRenameProjectFolder(renamingFolder, name)}
          onClose={() => {
            setRenamingFolder(null);
            restoreFocus();
          }}
        />
      ) : null}
      {fetchAll ? (
        <GroupFetchPopover
          key={fetchAll.id}
          x={fetchAll.x}
          y={fetchAll.y}
          name={loadProjectGroups().find((item) => item.id === fetchAll.id)?.name ?? "group"}
          paths={fetchAll.paths}
          onClose={() => {
            setFetchAll(null);
            restoreFocus();
          }}
        />
      ) : null}
      {notificationMenu ? (
        <Popover
          key={notificationMenu.path}
          anchor={{ x: notificationMenu.x, y: notificationMenu.y }}
          gap={0}
          width={280}
          role="dialog"
          aria-label={t("Mute project notifications")}
          onDismiss={closeNotificationMenu}
          className="space-y-1 overflow-y-auto p-3"
        >
          <p
            className="truncate px-1 text-xs font-medium text-content/85"
            title={notificationMenu.project.name}
          >
            {notificationMenu.project.name}
          </p>
          <NotificationMuteDatePicker
            projectIds={[notificationMenu.project.id]}
            onCancel={closeNotificationMenu}
            onChanged={closeNotificationMenu}
          />
        </Popover>
      ) : null}
      {removingGroup ? (
        <RemoveProjectDialog
          name={removingGroup.name}
          path={removingGroup.paths[0] ?? ""}
          paths={removingGroup.paths}
          confirmDisabled={!groupRemovalValid(removingGroup)}
          onCancel={() => {
            setRemovingGroup(null);
            restoreFocus();
          }}
          onConfirm={async () => {
            if (!groupRemovalValid(removingGroup))
              throw new Error(
                t(
                  "Selection changed or a project is working. Close this dialog and review your selection.",
                ),
              );
            const ordered = [...removingGroup.paths].sort(
              (a, b) =>
                Number(sameProjectPath(a, activeProject ?? "")) -
                Number(sameProjectPath(b, activeProject ?? "")),
            );
            try {
              for (const path of ordered) {
                const context = removalContext.current;
                if (
                  !context.onRemoveProject ||
                  context.isProjectBusy?.(path) ||
                  getGroupLockView().lock.lockedGroupIds.has(removingGroup.id) ||
                  projectGroupIdForPath(path, loadProjectGroupAssignments()) !== removingGroup.id
                ) {
                  throw new Error(
                    t(
                      "Selection changed or a project is working. Close this dialog and review your selection.",
                    ),
                  );
                }
                await context.onRemoveProject(path, { purgeData: true });
                if (projectGroupIdForPath(path, loadProjectGroupAssignments()) === removingGroup.id)
                  setProjectGroupAssignment(path, null);
              }
              // New members must never be removed by an older confirmation.
              const assignments = loadProjectGroupAssignments();
              if (Object.values(assignments).includes(removingGroup.id))
                throw new Error(
                  t(
                    "Selection changed or a project is working. Close this dialog and review your selection.",
                  ),
                );
              if (!deleteProjectGroup(removingGroup.id))
                throw new Error(t("Could not save project changes. Try again."));
              setRemovingGroup(null);
              restoreFocus();
            } catch (error) {
              setRemovingGroup((current) =>
                current
                  ? {
                      ...current,
                      paths: current.paths.filter(
                        (path) =>
                          projectGroupIdForPath(path, loadProjectGroupAssignments()) === current.id,
                      ),
                    }
                  : null,
              );
              throw error;
            }
          }}
        />
      ) : null}
      {removing ? (
        <RemoveProjectDialog
          name={removing.name}
          path={removing.path}
          onConfirm={async () => {
            await onRemoveProject?.(removing.path, { purgeData: true });
            setProjectGroupAssignment(removing.path, null);
            setRemoving(null);
            restoreFocus();
          }}
          onCancel={() => {
            setRemoving(null);
            restoreFocus();
          }}
        />
      ) : null}
      {lockDialog?.kind === "unlock" ? (
        <UnlockGroupDialog
          groupId={lockDialog.groupId}
          name={lockDialog.name}
          onClose={() => {
            setLockDialog(null);
            restoreFocus();
          }}
        />
      ) : null}
      {lockDialog?.kind === "remove-lock" ? (
        <PasswordPromptDialog
          title={t("Remove lock from {p0}", { p0: lockDialog.name })}
          description={t("The group stays; it just stops asking for the password.")}
          submitLabel="Remove lock"
          danger
          verify={(password) => removeGroupLock(lockDialog.groupId, password)}
          onDone={() => {
            setLockDialog(null);
            restoreFocus();
          }}
          onClose={() => {
            setLockDialog(null);
            restoreFocus();
          }}
        />
      ) : null}
      {lockDialog?.kind === "set" ? (
        <SetLockPasswordDialog
          mode="set"
          onDone={() => {
            makeGroupLockable(lockDialog.groupId);
            if (lockDialog.lockNow) lockGroup(lockDialog.groupId);
          }}
          onClose={() => {
            setLockDialog(null);
            restoreFocus();
          }}
        />
      ) : null}
      {additionalDirsProject ? (
        <AdditionalDirsDialog
          project={additionalDirsProject.path}
          name={additionalDirsProject.name}
          onClose={() => {
            setAdditionalDirsProject(null);
            restoreFocus();
          }}
        />
      ) : null}
      {backgroundProject ? (
        <ProjectBackgroundDialog
          project={backgroundProject.project}
          name={backgroundProject.name}
          onClose={() => {
            setBackgroundProject(null);
            restoreFocus();
          }}
        />
      ) : null}
    </>
  );

  return {
    open,
    openGroupMenu,
    createGroup,
    toggleGroupLock,
    requestUnlock,
    close,
    dismiss,
    isOpen: projectMenu != null,
    /** True while any menu or dialog opened from the project menu is showing. */
    isActive:
      projectMenu != null ||
      groupMenu != null ||
      removingGroup != null ||
      fetchAll != null ||
      notificationMenu != null ||
      additionalDirsProject != null ||
      removing != null ||
      backgroundProject != null ||
      lockDialog != null,
    element,
  };
}
