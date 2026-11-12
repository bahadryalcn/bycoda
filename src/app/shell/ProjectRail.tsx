import { Text } from "../../shared/ui/Text";
import { Badge } from "../../shared/ui/Badge";
import { StatusDot } from "../../shared/ui/StatusDot";
import { InlineError } from "../../shared/ui/InlineError";
import { withRoomPrivacyMutation } from "../../features/group-lock/model/roomPrivacyProjection";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { Checkbox } from "../../shared/ui/Checkbox";
import { Button } from "../../shared/ui/Button";
import { ActionHost, InlineAction } from "../../shared/ui/ActionHost";
import { Tooltip } from "../../shared/ui/Tooltip";
import { Sash } from "../../shared/ui/Sash";
import { WindowChromeInset } from "../../shared/ui/PaneHeader";
import { useWorkspaceFeatures } from "../../features/settings/model/workspaceFeatures";
import { useLocale, useT } from "../../shared/i18n";
import { SOCIAL_PANEL_EVENT } from "../../features/social/ui/SocialShortcut";
import {
  ProjectMultiSelect,
  useProjectMultiSelect,
} from "../../features/projects/ui/ProjectMultiSelect";
import {
  moveSelectedProjects,
  selectProjectRange,
} from "../../features/projects/model/projectSelection";
import {
  AlertCircle,
  Archive,
  Globe,
  BellOff,
  Check,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  FolderTree,
  GitBranch,
  Internet,
  Inbox,
  Link as LinkIcon,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pin,
  PinOff,
  CircleAlert,
  File,
  FileDiff,
  StickyNote,
  Plus,
  Sparkles,
  Zap,
  DashboardSquare,
  Server,
} from "../../shared/ui/icons";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useProjectLogoPath } from "./useProjectLogoPath";
import { useRailBackground } from "./useRailBackground";
import { useRemoteProject } from "./useRemoteProject";
import { useMuteStatuses } from "./useMuteStatuses";
import { useStableCallback } from "../../shared/hooks/useStableCallback";
import { useDragResize } from "../../shared/hooks/useDragResize";
import { useLockOverscroll } from "../../shared/hooks/useLockOverscroll";
import {
  useProjectDiffStats,
  useProjectsDiffStats,
} from "../../features/source-control/hooks/useProjectDiffStats";
import { useAnimatedReorder } from "../../shared/hooks/useAnimatedReorder";
import {
  COLLAPSE_DURATION_MS,
  useCollapsibleHeight,
} from "../../shared/hooks/useCollapsibleHeight";
import { useTabGroupLogos } from "../../features/projects/hooks/useTabGroupLogos";
import { useProjectGroupMembers } from "../../features/projects/hooks/useProjectGroupMembers";
import {
  loadProjectRailWidth,
  PROJECT_RAIL_COMPACT_WIDTH,
  PROJECT_RAIL_WIDTH_DEFAULT,
  PROJECT_RAIL_WIDTH_MAX,
  saveProjectRailWidth,
} from "../../features/settings/model/appearance";
import { basename } from "../../platform/tauri/fs";
import { IS_MAC } from "../../platform/tauri/platform";
import { useKeybindingShortcut } from "../../features/settings/model/useKeybindingShortcut";
import { DiffStat } from "../../shared/ui/DiffStat";
import { pathKey, projectKey, projectName } from "../../shared/lib/paths";
import {
  collectRailProjects,
  isLocalProject,
  loadPinnedProjects,
  loadRecents,
  newProjectPaths,
  projectRailSections,
  sameProjectPath,
  savePinnedProjects,
  syncProjectRailOrder,
  toggleProjectPin,
  type RecentProject,
} from "../../features/projects/model/recents";
import {
  railBackgroundColor,
  resolveTabGroupColor,
  resolveTabGroupLabel,
  resolveTabGroupMascot,
} from "../../features/workspace/model/tabGroups";
import {
  changeProjectGroupMembers,
  projectGroupColor,
  projectGroupIdForPath,
  projectGroupIdsToExpand,
  projectGroupParentId,
  projectGroupWorkspaceRoot,
  projectGroupWorkspaceRootKeys,
  addListedWorkspaceRoots,
  reorderProjectGroups,
  updateProjectGroup,
  type ProjectGroup,
} from "../../features/projects/model/projectGroups";
import { shouldShowLiveAgents, type LiveAgent } from "../../features/sessions/model/liveAgents";
import {
  LiveAgentsPreview,
  liveHeadline,
  summarizeLiveAgents,
} from "../../features/sessions/ui/LiveAgentsPreview";
import { TerminalSpinner } from "../../features/sessions/ui/TerminalSpinner";
import { ProjectLogoIcon } from "../../features/projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../features/projects/ui/ProjectMascot";
import { RailToolGroup } from "./RailToolGroup";
import { RailBrand } from "./RailBrand";
import {
  dismissRemoteProjects,
  type RemoteOnlyProject,
} from "../../features/sync/model/syncProjects";
import { ExplorerMenu } from "../../features/files/ui/ExplorerMenu";
import {
  remoteOnlyProjectHint,
  remoteOpenMatchIn,
  useRemoteOpenTargets,
} from "../../features/sync/model/syncRemoteProjects";
import { LastSessionsSection, type RecentSessionsSource } from "./LastSessionsSection";
import { TabVisitNav } from "./TitleBar";
import {
  openAssistantRoom,
  useAssistantRoomLabel,
} from "../../features/assistant/model/assistantClient";
import { SidebarUpdateFooter } from "./SidebarUpdate";
import { SidebarAccountFooter } from "./SidebarAccountFooter";
import type { InstalledUpdate } from "../model/updateNotice";
import type { SettingsSectionId } from "../../features/settings/model/settings";
import { InboxNotificationMenu } from "./sidebarSurfaces";
import { useProjectNotificationPreferences } from "../../features/notifications/hooks/useProjectNotificationPreferences";
import { useNotificationProjects } from "../../features/notifications/hooks/useNotificationProjects";
import { OPEN_REMOTE_PROJECT_EVENT } from "../../features/connections/model/connections";
import { OPEN_CODE_WORKSPACE_EVENT } from "../../features/projects/model/codeWorkspace";
import { OPEN_SESSION_IMPORT_EVENT } from "../../features/sessions/import/importModel";
import {
  useRemoteMachineOnline,
  useRemoteMachines,
} from "../../features/connections/model/connections";
import { machineLabel } from "../../features/connections/model/machineIdentity";
import { connectionIndicator } from "../../features/connections/model/remoteConnection";
import { useRemoteConnection } from "../../features/connections/model/useRemoteConnection";
import { useProjectMenu, type ProjectMenuMove } from "./useProjectMenu";
import { sidePaneMaxWidth } from "./sidePaneWidth";
import { GroupGitPopover } from "../../features/projects/ui/GroupGitPopover";
import {
  projectGitChange,
  projectGitChangeSpoken,
  projectGitChangeSummary,
  projectGitCountLabel,
  projectGitDetailBucket,
  type ProjectGitChange,
} from "../../features/projects/ui/projectGitChange";
import {
  duplicateProjectNames,
  isDuplicateProjectName,
  parentFolderLabel,
} from "../../features/projects/ui/projectIdentity";
import "./projectRailRow.css";
import {
  OPEN_PROJECT_CHANGES_EVENT,
  summarizeGroupGit,
} from "../../features/projects/model/groupGit";
import { useLinkedGroupStatus } from "../../features/projects/model/linkedWorkspace";
import { useGroupLock } from "../../features/group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../features/group-lock/model/lockState";
import type { RailSectionId } from "../../features/projects/model/railSections";
import { CrewRailSection } from "../../features/crews/ui/CrewRailSection";
import type { BackgroundSessionTarget } from "../../features/tasks/model/backgroundSession";
import {
  RAIL_DRAG_HANDLE,
  RAIL_SECTION_BLOCK,
  RailSectionHeader,
  useRailSections,
  type RailSectionDrag,
} from "./useRailSections";
import { commitProjectRailOrder, useProjectRailData } from "./useProjectRailData";
import { useRetainedWhileClosing } from "./useRetainedWhileClosing";

/** Dismissal key for the Projects section shown open for the active project. */
const PROJECTS_REVEAL_ID = "section:projects";
/**
 * The wide rail is never dragged into a crushed layout: its minimum is the width where it
 * goes icon-only (this also clears the macOS window buttons and panel toggle). A pointer drag
 * released this far below it hands over to the compact rail instead.
 */
const railMin = PROJECT_RAIL_COMPACT_WIDTH;
const RAIL_COLLAPSE_MARGIN = 40;

// The rail goes icon-only below PROJECT_RAIL_COMPACT_WIDTH (140px). That is a
// container query on `@container/rail`, so it follows a drag with no re-render.
// Tailwind needs the classes written out: spell it `@max-[140px]/rail:`.
// Below PROJECT_RAIL_NARROW_WIDTH (200px) shortcut hints drop: `@max-[200px]/rail:`.

type Props = {
  onRenameProjectFolder?: (path: string, name: string) => Promise<void>;
  recoveryControl?: ReactNode;
  visible?: boolean;
  resizable?: boolean;
  /** Navigator embeds the same project/group ledger without application chrome. */
  presentation?: "panel" | "navigator";
  /**
   * Narrows the listed projects and groups by name or path. Only the list shown changes: the
   * saved order, pins, group membership and project data are never filtered.
   */
  projectFilter?: string;
  cwd: string;
  recents: RecentProject[];
  inboxUnseen?: boolean;
  busyPaths?: Iterable<string>;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onSearch?: () => void;
  searchActive?: boolean;
  onOpenInbox?: () => void;
  inboxActive?: boolean;
  notesEnabled?: boolean;
  onOpenNotes?: () => void;
  notesActive?: boolean;
  onOpenAutomations?: () => void;
  onOpenTasks?: () => void;
  automationsActive?: boolean;
  tasksActive?: boolean;
  socialActive?: boolean;
  assistantActive?: boolean;
  onOpenServers?: () => void;
  serversActive?: boolean;
  onTogglePanel?: () => void;
  /** Called when a drag ends far below the minimum width; omit to only clamp at the minimum. */
  onCollapse?: () => void;
  onSelectProject: (path: string) => void;
  onOpenProject: () => void | Promise<void>;
  /** Lets the user pick this machine's folder for a project only another machine has. */
  onOpenSyncedProject?: (projectId: string, name: string) => void | Promise<void>;
  onRemoveProject?: (path: string, options: { purgeData: boolean }) => void | Promise<void>;
  liveAgents?: LiveAgent[];
  /**
   * The layout owner decides whether this rail shows the live-agent summary. The compact
   * Projects popup turns it off while the sidebar already shows the canonical summary.
   */
  showLiveAgents?: boolean;
  activeSessionId?: string;
  onSelectAgent?: (sessionId: string) => void;
  onPreviewSession?: (sessionId: string, options?: { keepOpen?: boolean }) => void;
  /** Opens a crew's coordinator; the Crews section needs it to open running crews. */
  onOpenCrewSession?: (target: BackgroundSessionTarget) => void | Promise<void>;
  recentSessions?: RecentSessionsSource;
  onOpenLastSessions?: () => void;
  lastSessionsOpen?: boolean;
  onSelectListedSession?: (
    sessionId: string,
    cwd: string,
    options?: { keepOpen?: boolean },
  ) => void;
  settingsOpen?: boolean;
  /** Settings dialog is open over the rail: selects the Settings tool without hiding rail chrome. */
  settingsDialogOpen?: boolean;
  settingsSection?: SettingsSectionId;
  onOpenSettings?: () => void;
  onOpenNotificationSettings?: (projectPath?: string) => void;
  onSelectSettingsSection?: (section: SettingsSectionId) => void;
  onCloseSettings?: () => void;
  updateNotice?: InstalledUpdate | null;
  onOpenWhatsNew?: (version: string) => void;
  onDismissUpdate?: () => void;
};

export function ProjectRail({
  onRenameProjectFolder,
  recoveryControl,
  visible = true,
  resizable = true,
  presentation = "panel",
  projectFilter = "",
  cwd,
  recents,
  inboxUnseen = false,
  busyPaths,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  onSearch,
  searchActive = false,
  onOpenInbox,
  inboxActive = false,
  notesEnabled = true,
  onOpenNotes,
  notesActive = false,
  onOpenAutomations,
  onOpenTasks,
  automationsActive = false,
  tasksActive = false,
  socialActive = false,
  assistantActive = false,
  onOpenServers,
  serversActive = false,
  onTogglePanel,
  onCollapse,
  onSelectProject,
  onOpenProject,
  onOpenSyncedProject,
  onRemoveProject,
  liveAgents = [],
  showLiveAgents = true,
  activeSessionId,
  onSelectAgent,
  onPreviewSession,
  onOpenCrewSession,
  recentSessions,
  onOpenLastSessions,
  lastSessionsOpen = false,
  onSelectListedSession,
  settingsOpen = false,
  onOpenSettings,
  onOpenNotificationSettings,
  onSelectSettingsSection,
  onCloseSettings,
  updateNotice = null,
  onOpenWhatsNew,
  onDismissUpdate,
}: Props) {
  const openAccountSettings =
    onOpenSettings && onSelectSettingsSection
      ? () => {
          onOpenSettings();
          onSelectSettingsSection("account");
        }
      : undefined;
  const t = useT();
  const navigator = presentation === "navigator";
  const workspaceFeatures = useWorkspaceFeatures();
  const inboxShortcut = useKeybindingShortcut("App: Open Inbox");
  const notesShortcut = useKeybindingShortcut("App: Open Notes");
  const automationsShortcut = useKeybindingShortcut("App: Open Automations");
  const tasksShortcut = useKeybindingShortcut("App: Open Tasks");
  const assistantLabel = useAssistantRoomLabel();
  // Read once: the saved width is localStorage, which the compiler cannot see change.
  const [initialRailWidth] = useState(loadProjectRailWidth);
  const commitRailWidth = (width: number) => saveProjectRailWidth(width);
  const resize = useDragResize({
    min: railMin,
    max: () => sidePaneMaxWidth("rail", PROJECT_RAIL_WIDTH_MAX, 0.35, railMin),
    defaultWidth: PROJECT_RAIL_WIDTH_DEFAULT,
    initial: initialRailWidth,
    onCommit: commitRailWidth,
    collapseBelow: railMin - RAIL_COLLAPSE_MARGIN,
    onCollapse,
  });
  // Destructured: the compiler treats a direct `.setPaneRef` read as a ref access during render.
  const { setPaneRef: attachRailPane } = resize;
  const {
    railOrder,
    pinnedPaths,
    groupLabels,
    groupColors,
    groupMascots,
    groupCustomColors,
    projectGroups,
    projectGroupAssignments,
    remoteOnly,
  } = useProjectRailData();
  const [groupMutationError, setGroupMutationError] = useState(false);
  const [revealDismissed, setRevealDismissed] = useState<{ cwd: string; ids: string[] }>({
    cwd,
    ids: [],
  });
  const [lastSessionsShown, setLastSessionsShown] = useState(false);
  const [crewsShown, setCrewsShown] = useState(false);
  const [inboxMenu, setInboxMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Focus after flyout placement; active/first-row focus enables paging. Closing restores trigger focus.
  useEffect(() => {
    if (!navigator || !visible) return;
    let frame = 0;
    let attempts = 0;
    const focusRow = () => {
      const list = scrollRef.current;
      const flyout = list?.closest("[data-project-navigation-flyout]");
      if (!list || !flyout) return;
      const active = document.activeElement;
      if (active && active !== flyout && flyout.contains(active)) return;
      const target =
        list.querySelector<HTMLElement>("[data-project-path] button[aria-current]") ??
        list.querySelector<HTMLElement>("[data-project-path] button");
      target?.focus();
      attempts += 1;
      if (document.activeElement !== target && attempts < 12)
        frame = requestAnimationFrame(focusRow);
    };
    frame = requestAnimationFrame(focusRow);
    return () => cancelAnimationFrame(frame);
  }, [navigator, visible]);
  // Scroll mounted rows into view without expanding collapsed groups.
  const revealProject = (path: string) => {
    requestAnimationFrame(() => {
      const root = scrollRef.current;
      // Never move the list under a drag-reorder in progress.
      if (!root || root.querySelector("[data-dragging]")) return;
      for (const row of root.querySelectorAll<HTMLElement>("[data-project-path]")) {
        if (!sameProjectPath(row.dataset.projectPath ?? "", path)) continue;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        row.scrollIntoView({
          block: "nearest",
          behavior: reduce ? "auto" : "smooth",
        });
        return;
      }
    });
  };
  // Detect picker additions by comparing remembered projects; cancellation changes nothing.
  const handleAddProjectToGroup = (groupId: string) => {
    const before = loadRecents().map((item) => item.path);
    void (async () => {
      try {
        await onOpenProject();
      } catch {
        return;
      }
      const added = newProjectPaths(
        before,
        loadRecents().map((item) => item.path),
      );
      if (added.length === 0) return;
      await withRoomPrivacyMutation(() => {
        changeProjectGroupMembers(groupId, added, []);
        updateProjectGroup(groupId, (current) => ({ ...current, collapsed: false }));
      });
      setGroupMutationError(false);
      revealProject(added[added.length - 1]);
    })().catch(() => setGroupMutationError(true));
  };
  const busy = new Set<string>(busyPaths ?? []);
  const allProjects = useMemo(() => collectRailProjects(recents, cwd), [cwd, recents]);
  const projectMenu = useProjectMenu({
    onRenameProjectFolder,
    onRemoveProject,
    projectPaths: [...allProjects.values()].map((project) => project.path),
    activeProject: cwd,
    isProjectBusy: (path) => isBusyPath(path, busy),
    onOpenNotificationSettings,
    onAddProjectToGroup: handleAddProjectToGroup,
    onOpen: () => setInboxMenu(null),
  });
  useEffect(() => {
    if (visible) return;
    projectMenu.dismiss();
    setInboxMenu(null);
  }, [visible]);
  const notificationPreferences = useProjectNotificationPreferences();
  // Projects in a locked group stay in `allProjects` so their saved order and
  // pins survive, but nothing below lists them while the group is locked.
  const { lock, hiddenGroupIds } = useGroupLock();
  const railProjectKeys = new Set(
    [...allProjects.keys()].filter((key) => !lock.lockedProjectKeys.has(key)),
  );
  const visibleLiveAgents = liveAgents.filter((agent) => !isProjectLockedIn(lock, agent.cwd));
  const notificationProjects = useNotificationProjects([...allProjects.keys()]);
  // Display names need not be unique; rows that would read the same get a short folder hint.
  const nameCollisions = duplicateProjectNames(
    [...allProjects.values()].map((project) => ({
      path: project.path,
      name: resolveTabGroupLabel(projectKey(project.path), groupLabels, basename(project.path)),
    })),
    sameProjectPath,
  );
  const menuTrigger = useRef<HTMLElement | null>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const groupLogos = useTabGroupLogos();
  const muteStatuses = useMuteStatuses(notificationProjects.projects, notificationPreferences);
  const sections = useMemo(
    () => projectRailSections(recents, cwd, railOrder, pinnedPaths),
    [cwd, pinnedPaths, railOrder, recents],
  );
  const workspaceRootKeys = useMemo(
    () => projectGroupWorkspaceRootKeys(projectGroups),
    [projectGroups],
  );
  const filterQuery = projectFilter.trim().toLocaleLowerCase();
  const projectMatches = useCallback(
    (path: string) =>
      !filterQuery ||
      [
        resolveTabGroupLabel(projectKey(path), groupLabels, projectName(path)),
        projectName(path),
        path,
      ]
        .join("\n")
        .toLocaleLowerCase()
        .includes(filterQuery),
    [filterQuery, groupLabels],
  );
  const pinnedProjects = sections.pinned.filter(
    (item) =>
      !isProjectLockedIn(lock, item.path) &&
      !workspaceRootKeys.has(pathKey(item.path)) &&
      !projectGroupIdForPath(item.path, projectGroupAssignments) &&
      projectMatches(item.path),
  );
  const groupedProjectSections = useMemo(() => {
    const byGroup = new Map<string, RecentProject[]>(projectGroups.map((group) => [group.id, []]));
    const ungrouped: RecentProject[] = [];
    // A group whose own name matches keeps all of its projects visible.
    const groupNameMatches = (groupId: string | undefined) =>
      Boolean(filterQuery) &&
      Boolean(groupId) &&
      (projectGroups.find((group) => group.id === groupId)?.name ?? "")
        .toLocaleLowerCase()
        .includes(filterQuery);
    for (const project of sections.projects) {
      if (workspaceRootKeys.has(pathKey(project.path))) continue;
      const groupId = projectGroupIdForPath(project.path, projectGroupAssignments);
      if (!projectMatches(project.path) && !groupNameMatches(groupId)) continue;
      const items = groupId ? byGroup.get(groupId) : undefined;
      if (items) items.push(project);
      else ungrouped.push(project);
    }
    addListedWorkspaceRoots(
      projectGroups,
      sections,
      byGroup,
      (project, groupId) =>
        !isProjectLockedIn(lock, project.path) &&
        (projectMatches(project.path) || groupNameMatches(groupId)),
    );
    const workspaceItemsOf = (groupId: string) =>
      [...sections.pinned, ...sections.projects].filter(
        (project) =>
          projectGroupIdForPath(project.path, projectGroupAssignments) === groupId &&
          !workspaceRootKeys.has(pathKey(project.path)) &&
          !isProjectLockedIn(lock, project.path) &&
          (projectMatches(project.path) || groupNameMatches(groupId)),
      );
    // While filtering, keep a group that matched itself or holds a match, plus its parents.
    const keptGroupIds = new Set<string>();
    if (filterQuery) {
      const parentOf = new Map(
        projectGroups.map((group) => [
          group.id,
          projectGroupParentId(group, projectGroups, projectGroupAssignments),
        ]),
      );
      for (const group of projectGroups) {
        if (
          !groupNameMatches(group.id) &&
          (byGroup.get(group.id)?.length ?? 0) === 0 &&
          workspaceItemsOf(group.id).length === 0
        )
          continue;
        for (
          let id: string | undefined = group.id;
          id && !keptGroupIds.has(id);
          id = parentOf.get(id) ?? undefined
        )
          keptGroupIds.add(id);
      }
    }
    return {
      ungrouped,
      grouped: projectGroups
        .filter((group) => !hiddenGroupIds.has(group.id))
        .filter((group) => !filterQuery || keptGroupIds.has(group.id))
        .map((group) => ({
          group,
          parentId: projectGroupParentId(group, projectGroups, projectGroupAssignments),
          locked: lock.lockedGroupIds.has(group.id),
          items: lock.lockedGroupIds.has(group.id) ? [] : (byGroup.get(group.id) ?? []),
          workspaceItems: lock.lockedGroupIds.has(group.id) ? [] : workspaceItemsOf(group.id),
        })),
    };
  }, [
    filterQuery,
    lock,
    hiddenGroupIds,
    projectGroupAssignments,
    projectGroups,
    projectMatches,
    sections,
    workspaceRootKeys,
  ]);
  useEffect(() => {
    // Compute from the committed order, then persist once outside the updater.
    const synced = syncProjectRailOrder(railOrder, allProjects);
    if (synced.join("\0") === railOrder.join("\0")) return;
    commitProjectRailOrder(synced);
  }, [allProjects, railOrder]);
  useEffect(() => {
    // Saving announces the change, which reloads `pinnedPaths`. Grouped projects are never pinned.
    const pinned = loadPinnedProjects();
    const next = pinned.filter(
      (p) => allProjects.has(pathKey(p)) && !projectGroupIdForPath(p, projectGroupAssignments),
    );
    if (next.length !== pinned.length) savePinnedProjects(next);
  }, [allProjects, projectGroupAssignments]);
  // Follow the active project. Adding a project makes it the active one, so a
  // new row (it lands in "Projects", below every group) is brought into view
  // too. Keyed on the project, so scrolling by hand is left alone.
  useEffect(() => {
    if (!visible || !cwd) return;
    revealProject(cwd);
  }, [cwd, visible]);
  // Groups holding the active project render open so its row is visible. The
  // saved collapsed state is untouched; closing one by hand dismisses the reveal
  // until another project becomes active.
  const dismissedRevealIds = revealDismissed.cwd === cwd ? revealDismissed.ids : [];
  const revealedGroupIds = cwd
    ? projectGroupIdsToExpand(cwd, projectGroups, projectGroupAssignments).filter(
        (id) => !dismissedRevealIds.includes(id),
      )
    : [];
  const closeProjectMenu = useStableCallback(projectMenu.close);
  useEffect(() => {
    if (!projectMenu.isOpen) return;
    const onScroll = () => closeProjectMenu();
    // The column scrolls instead of the ledger in a short window; a capture listener on it sees both.
    const scrollParent = scrollRef.current?.parentElement ?? scrollRef.current ?? window;
    scrollParent.addEventListener("scroll", onScroll, true);
    return () => scrollParent.removeEventListener("scroll", onScroll, true);
  }, [projectMenu.isOpen, closeProjectMenu]);
  const reorderSubset = (fullOrder: string[], subsetOrder: string[], subsetPaths: Set<string>) => {
    const next: string[] = [];
    let subsetIndex = 0;
    for (const path of fullOrder) {
      if (!subsetPaths.has(path)) {
        next.push(path);
        continue;
      }
      if (subsetIndex < subsetOrder.length) {
        next.push(subsetOrder[subsetIndex++]);
      }
    }
    return next;
  };

  const onReorderPinned = (ids: string[]) => {
    const subset = new Set(pinnedProjects.map((item) => item.path));
    const next = reorderSubset(railOrder, ids, subset);
    commitProjectRailOrder(next);
  };

  const onReorderProjects = (ids: string[]) => {
    const subset = new Set(ids);
    const next = reorderSubset(railOrder, ids, subset);
    commitProjectRailOrder(next);
  };

  const pinnedIds = pinnedProjects.map((item) => item.path);
  const projectIds = groupedProjectSections.ungrouped.map((item) => item.path);
  // Spoken name of a project row: its label, never the row's stats and badges.
  const projectSpokenName = (path: string) =>
    resolveTabGroupLabel(projectKey(path), groupLabels, basename(path));
  const pinnedSortable = useAnimatedReorder(pinnedIds, onReorderPinned, "y", undefined, {
    label: projectSpokenName,
  });
  const projectSortable = useAnimatedReorder(projectIds, onReorderProjects, "y", undefined, {
    label: projectSpokenName,
  });
  // Menu "Move up/down" for the row's own list (pinned or ungrouped projects).
  const rowMove = (path: string): ProjectMenuMove | undefined => {
    const list = pinnedIds.includes(path)
      ? { ids: pinnedIds, sortable: pinnedSortable }
      : projectIds.includes(path)
        ? { ids: projectIds, sortable: projectSortable }
        : undefined;
    if (!list || list.ids.length < 2) return undefined;
    const index = list.ids.indexOf(path);
    return {
      up: index > 0 ? () => list.sortable.moveBy(path, -1) : undefined,
      down: index < list.ids.length - 1 ? () => list.sortable.moveBy(path, 1) : undefined,
    };
  };
  const onProjectContextMenu = (
    path: string,
    event: MouseEvent<HTMLElement>,
    onSelectForBulk?: () => void,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    // Focus returns to the project button, not its row, when the menu closes.
    const trigger =
      event.currentTarget.querySelector<HTMLButtonElement>("button") ?? event.currentTarget;
    trigger.focus();
    projectMenu.open(path, event.clientX, event.clientY, trigger, onSelectForBulk, rowMove(path));
  };
  // A group moves as a block: while one is dragged every group shows only its
  // header (the saved collapsed state is untouched), so the blocks stay one size.
  const commitGroupOrder = useCallback((ids: readonly string[]) => reorderProjectGroups(ids), []);
  const groupSortable = useAnimatedReorder(
    projectGroups
      .filter((group) => !projectGroupParentId(group, projectGroups, projectGroupAssignments))
      .map((group) => group.id),
    commitGroupOrder,
    "y",
    undefined,
    {
      foldOnDrag: true,
      label: (id) => projectGroups.find((group) => group.id === id)?.name ?? t("Group"),
    },
  );
  const shownSections = new Set<RailSectionId>(["projects"]);
  if (lastSessionsShown) shownSections.add("last-sessions");
  if (crewsShown) shownSections.add("crews");
  if (pinnedProjects.length > 0) shownSections.add("pinned");
  if (projectGroups.length > 0) shownSections.add("groups");
  const rail = useRailSections(shownSections);
  // A collapsed Projects section still shows the active project's row, under the
  // same dismissal as the groups above.
  const activeUngrouped = groupedProjectSections.ungrouped.some((item) =>
    sameProjectPath(item.path, cwd),
  );
  const projectsRevealed =
    rail.collapsed.projects && activeUngrouped && !dismissedRevealIds.includes(PROJECTS_REVEAL_ID);
  const selectionBuckets = {
    pinned: pinnedIds,
    groups: groupedProjectSections.grouped
      .filter(({ locked }) => !locked)
      .map(({ items }) => items.map((item) => item.path)),
    projects: projectIds,
  };
  const selectionPaths = [
    ...new Map(
      rail.order
        .flatMap((id) =>
          id === "groups"
            ? selectionBuckets.groups.flat()
            : id === "pinned"
              ? pinnedIds
              : id === "projects"
                ? projectIds
                : [],
        )
        .filter(
          (path) =>
            path !== "~" &&
            !hiddenGroupIds.has(projectGroupIdForPath(path, projectGroupAssignments) ?? "") &&
            !isProjectLockedIn(lock, path),
        )
        .map((path) => [pathKey(path), path]),
    ).values(),
  ];
  const moveSelection = (selected: ReadonlySet<string>, step: -1 | 1) =>
    moveSelectedProjects(
      railOrder,
      [pinnedIds, ...selectionBuckets.groups, projectIds],
      selected,
      step,
    );
  const searchOrPageActive =
    lastSessionsOpen ||
    searchActive ||
    inboxActive ||
    notesActive ||
    automationsActive ||
    tasksActive ||
    socialActive ||
    assistantActive ||
    serversActive;
  const brand = (placement: "title" | "column", narrowOnly = false) => (
    <RailBrand
      placement={placement}
      narrowOnly={narrowOnly}
      showSearch={!settingsOpen}
      searchActive={searchActive}
      onSearch={onSearch}
    />
  );
  const renderProjectGroup = (
    { group, items, workspaceItems, locked }: (typeof groupedProjectSections.grouped)[number],
    sortableGroups: SortableHandle = groupSortable,
  ): ReactNode => (
    <ProjectGroupSection
      key={group.id}
      group={group}
      items={items}
      workspaceItems={workspaceItems}
      locked={locked}
      revealed={revealedGroupIds.includes(group.id)}
      sortableGroups={sortableGroups}
      muteStatuses={muteStatuses}
      nameCollisions={nameCollisions}
      focusHint={!navigator}
      cwd={cwd}
      busy={busy}
      statsEnabled={visible}
      searchActive={searchOrPageActive}
      onSelect={onSelectProject}
      onContextMenu={onProjectContextMenu}
      onOpenMenu={(path, x, y, onSelectForBulk) =>
        projectMenu.open(path, x, y, undefined, onSelectForBulk, rowMove(path))
      }
      onReorder={onReorderProjects}
      onToggleCollapsed={() => {
        if (locked) {
          projectMenu.requestUnlock(group.id);
          return;
        }
        const revealed = revealedGroupIds.includes(group.id);
        if (revealed) setRevealDismissed({ cwd, ids: [...dismissedRevealIds, group.id] });
        // A group shown open only for the active project is already saved collapsed.
        if (revealed && group.collapsed) return;
        updateProjectGroup(group.id, (current) => ({
          ...current,
          collapsed: !current.collapsed,
        }));
      }}
      onToggleLock={() => projectMenu.toggleGroupLock(group.id)}
      onOpenGroupMenu={(x, y, onOpenGitOverview) =>
        projectMenu.openGroupMenu(
          group.id,
          x,
          y,
          {
            up: () => sortableGroups.moveBy(group.id, -1),
            down: () => sortableGroups.moveBy(group.id, 1),
          },
          onOpenGitOverview,
        )
      }
      groupLabels={groupLabels}
      groupColors={groupColors}
      groupCustomColors={groupCustomColors}
      groupLogos={groupLogos}
      groupMascots={groupMascots}
      workspaceIds={groupedProjectSections.grouped
        .filter((entry) => entry.parentId === group.id)
        .map((entry) => entry.group.id)}
    >
      {(id, membersSortable) => {
        const entry = groupedProjectSections.grouped.find((item) => item.group.id === id);
        return entry ? renderProjectGroup(entry, membersSortable) : null;
      }}
    </ProjectGroupSection>
  );
  // Destructured: the compiler treats a direct `.setRef` read as a ref access during render.
  const groupsDrag = rail.drag("groups");
  const { setRef: setGroupsSectionRef } = groupsDrag;
  const sectionNodes: Record<RailSectionId, ReactNode> = {
    "last-sessions": recentSessions ? (
      <div className="shrink-0 @max-[140px]/rail:hidden">
        <LastSessionsSection
          source={recentSessions}
          onOpenLastSessions={onOpenLastSessions}
          lastSessionsOpen={lastSessionsOpen}
          projectKeys={railProjectKeys}
          enabled={visible}
          activeSessionId={activeSessionId}
          searchActive={searchOrPageActive}
          onOpenSession={
            onSelectListedSession ??
            ((id, _cwd, options) => (onPreviewSession ?? onSelectAgent)?.(id, options))
          }
          onOpenProject={onSelectProject}
          drag={rail.drag("last-sessions")}
          onShownChange={setLastSessionsShown}
          groupLabels={groupLabels}
          groupColors={groupColors}
          groupCustomColors={groupCustomColors}
          groupLogos={groupLogos}
          groupMascots={groupMascots}
        />
      </div>
    ) : null,
    pinned:
      pinnedProjects.length > 0 ? (
        <ProjectSection
          label={t("Pinned")}
          collapsed={rail.collapsed.pinned}
          onToggleCollapsed={() => rail.toggleCollapsed("pinned")}
          items={pinnedProjects}
          muteStatuses={muteStatuses}
          nameCollisions={nameCollisions}
          focusHint={!navigator}
          cwd={cwd}
          busy={busy}
          statsEnabled={visible}
          sortable={pinnedSortable}
          drag={rail.drag("pinned")}
          pinned
          searchActive={searchOrPageActive}
          onSelect={onSelectProject}
          onTogglePin={toggleProjectPin}
          onContextMenu={onProjectContextMenu}
          onOpenMenu={(path, x, y, onSelectForBulk) =>
            projectMenu.open(path, x, y, undefined, onSelectForBulk, rowMove(path))
          }
          groupLabels={groupLabels}
          groupColors={groupColors}
          groupCustomColors={groupCustomColors}
          groupLogos={groupLogos}
          groupMascots={groupMascots}
        />
      ) : null,
    groups:
      projectGroups.length > 0 ? (
        <div
          ref={setGroupsSectionRef}
          className={RAIL_SECTION_BLOCK}
          data-collapsed={rail.collapsed.groups || undefined}
        >
          <ProjectSectionHeader
            label={t("Groups")}
            drag={groupsDrag}
            collapsed={rail.collapsed.groups}
            onToggleCollapsed={() => rail.toggleCollapsed("groups")}
            onAddGroup={(x, y) => projectMenu.createGroup(x, y)}
          />
          <div
            hidden={rail.folded || rail.collapsed.groups}
            className={`flex-col gap-px px-2 ${rail.folded || rail.collapsed.groups ? "hidden" : "flex"}`}
          >
            {groupedProjectSections.grouped
              .filter((entry) => !entry.parentId)
              .map((entry) => renderProjectGroup(entry))}
          </div>
        </div>
      ) : null,
    crews:
      onOpenCrewSession && cwd && cwd !== "~" ? (
        <CrewRailSection
          key={cwd}
          cwd={cwd}
          drag={rail.drag("crews")}
          collapsed={rail.collapsed.crews}
          onToggleCollapsed={() => rail.toggleCollapsed("crews")}
          onShownChange={setCrewsShown}
          onOpenSession={onOpenCrewSession}
        />
      ) : null,
    projects: (
      <ProjectSection
        label={t("Projects")}
        collapsed={rail.collapsed.projects && !projectsRevealed}
        onToggleCollapsed={() => {
          if (activeUngrouped)
            setRevealDismissed({ cwd, ids: [...dismissedRevealIds, PROJECTS_REVEAL_ID] });
          // Shown open only for the active project: the saved state is already collapsed.
          if (projectsRevealed) return;
          rail.toggleCollapsed("projects");
        }}
        items={groupedProjectSections.ungrouped}
        muteStatuses={muteStatuses}
        nameCollisions={nameCollisions}
        focusHint={!navigator}
        emptyLabel={
          sections.projects.length === 0 && projectGroups.length === 0
            ? "No projects yet"
            : filterQuery &&
                pinnedProjects.length === 0 &&
                groupedProjectSections.ungrouped.length === 0 &&
                groupedProjectSections.grouped.length === 0
              ? t("No projects found")
              : undefined
        }
        onAdd={onOpenProject}
        remoteOnly={remoteOnly}
        onOpenSynced={onOpenSyncedProject}
        cwd={cwd}
        busy={busy}
        statsEnabled={visible}
        sortable={projectSortable}
        drag={rail.drag("projects")}
        pinned={false}
        searchActive={searchOrPageActive}
        onSelect={onSelectProject}
        onTogglePin={toggleProjectPin}
        onContextMenu={onProjectContextMenu}
        onOpenMenu={(path, x, y, onSelectForBulk) =>
          projectMenu.open(path, x, y, undefined, onSelectForBulk, rowMove(path))
        }
        groupLabels={groupLabels}
        groupColors={groupColors}
        groupCustomColors={groupCustomColors}
        groupLogos={groupLogos}
        groupMascots={groupMascots}
      />
    ),
  };
  const liveStatus = showLiveAgents ? (
    <>
      {/* The status block is inset 7px (bycoda.css), the same column as the tools above. */}
      <div className="shrink-0 @max-[140px]/rail:hidden">
        <LiveAgentsPreview
          agents={visibleLiveAgents}
          currentProject={lastSessionsOpen ? undefined : cwd}
          activeSessionId={activeSessionId}
          onSelect={onSelectAgent}
          collapsible
          groupLabels={groupLabels}
          groupColors={groupColors}
          groupCustomColors={groupCustomColors}
          groupMascots={groupMascots}
        />
      </div>
      <CompactLiveAgents
        agents={visibleLiveAgents}
        activeSessionId={activeSessionId}
        onSelect={onSelectAgent}
        groupLabels={groupLabels}
        groupColors={groupColors}
        groupCustomColors={groupCustomColors}
        groupMascots={groupMascots}
      />
    </>
  ) : null;
  return (
    <nav
      ref={attachRailPane}
      data-side-pane="rail"
      data-usage-guide="project-navigation"
      aria-label={t("Projects")}
      className={`bycoda-project-rail sidebar-glass relative shrink-0 flex-col border-r border-(--ui-pane-border) pe-1.5 ${visible ? "flex" : "hidden"}`}
    >
      {groupMutationError && (
        <InlineError>{t("Could not add projects to the group. Please try again.")}</InlineError>
      )}
      {!navigator ? (
        <div
          className="@container/rail flex h-10 shrink-0 select-none items-center overflow-hidden"
          data-tauri-drag-region="deep"
        >
          <WindowChromeInset />
          {IS_MAC ? null : brand("title")}
          {IS_MAC ? <div className="min-w-0 flex-1" /> : null}
          {/* Icon-only, just the panel toggle fits; in settings nothing does. */}
          <div
            className={`me-1.5 shrink-0 @max-[140px]/rail:mx-auto ${
              settingsOpen
                ? "bycoda-rail-visit-nav--settings @max-[140px]/rail:hidden"
                : "bycoda-rail-visit-nav"
            }`}
          >
            <TabVisitNav
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              onGoBack={onGoBack}
              onGoForward={onGoForward}
              onTogglePanel={settingsOpen ? undefined : onTogglePanel}
              panelActive
            />
          </div>
        </div>
      ) : null}

      {/* Tools, live summary and update notices can exceed a short window. Above the short-height query the
          ledger is the only scroll owner; below it this column scrolls without nested scrollbars. Settings
          stays outside this column so it remains visible at every height. The popup scrolls only its ledger. */}
      <div
        className={`flex min-h-0 flex-1 flex-col ${
          navigator
            ? "@container/rail"
            : "[container:rail/size] overflow-y-auto overflow-x-hidden overscroll-none"
        }`}
      >
        {navigator ? null : IS_MAC ? brand("column") : brand("column", true)}
        {settingsOpen && !navigator ? (
          <Button
            variant="ghost"
            motion="none"
            type="button"
            className="bycoda-settings-return"
            onClick={() => onCloseSettings?.()}
          >
            {t("Back to workspace")}
          </Button>
        ) : (
          <>
            {!navigator ? (
              <>
                <nav
                  aria-label={t("Workspace tools")}
                  data-usage-guide="rail-tools"
                  className="bycoda-rail-tools shrink-0"
                >
                  <RailToolGroup
                    label={t("Workspace tools")}
                    tools={[
                      {
                        id: "servers",
                        label: t("Servers"),
                        icon: <Server className="icon-sm" />,
                        active: serversActive,
                        onSelect: onOpenServers,
                      },
                      ...(workspaceFeatures.inbox || inboxActive
                        ? [
                            {
                              id: "inbox",
                              label: t("Inbox"),
                              icon: <Inbox className="icon-sm" />,
                              active: inboxActive,
                              shortcut: inboxShortcut,
                              dot: inboxUnseen ? t("New items") : undefined,
                              guide: "rail-inbox",
                              onSelect: onOpenInbox,
                              onOpenContextMenu: (x: number, y: number) => {
                                menuTrigger.current =
                                  document.activeElement instanceof HTMLElement
                                    ? document.activeElement
                                    : null;
                                projectMenu.close();
                                setInboxMenu({ x, y });
                              },
                            },
                          ]
                        : []),
                      ...(notesEnabled
                        ? [
                            {
                              id: "notes",
                              label: t("Notes"),
                              icon: <StickyNote className="icon-sm" />,
                              active: notesActive,
                              shortcut: notesShortcut,
                              guide: "rail-notes",
                              onSelect: onOpenNotes,
                            },
                          ]
                        : []),
                      ...(workspaceFeatures.automations || automationsActive
                        ? [
                            {
                              id: "automations",
                              label: t("Automations"),
                              icon: <Zap className="icon-sm" />,
                              active: automationsActive,
                              shortcut: automationsShortcut,
                              guide: "rail-automations",
                              onSelect: onOpenAutomations,
                            },
                          ]
                        : []),
                      ...(workspaceFeatures.social || socialActive
                        ? [
                            {
                              id: "social",
                              label: t("Social Media"),
                              icon: <Globe className="icon-sm" />,
                              active: socialActive,
                              onSelect: () => {
                                window.dispatchEvent(
                                  new CustomEvent(SOCIAL_PANEL_EVENT, { detail: { cwd } }),
                                );
                              },
                            },
                          ]
                        : []),
                      ...(workspaceFeatures.tasks || tasksActive
                        ? [
                            {
                              id: "tasks",
                              label: t("Tasks"),
                              icon: <DashboardSquare className="icon-sm" />,
                              active: tasksActive,
                              shortcut: tasksShortcut,
                              guide: "rail-tasks",
                              onSelect: onOpenTasks,
                            },
                          ]
                        : []),
                      {
                        id: "assistant",
                        label: assistantLabel,
                        icon: <Sparkles className="icon-sm" />,
                        active: assistantActive,
                        guide: "rail-assistant",
                        onSelect: () => openAssistantRoom(),
                      },
                    ]}
                  />
                </nav>
              </>
            ) : null}
            <div className="bycoda-rail-status shrink-0">
              {recoveryControl}
              {navigator ? null : liveStatus}
            </div>
            <ProjectMultiSelect
              paths={selectionPaths}
              groups={projectGroups.filter(
                (group) => !hiddenGroupIds.has(group.id) && !lock.lockedGroupIds.has(group.id),
              )}
              busy={(path) => isBusyPath(path, busy)}
              canMove={(selected, step) =>
                moveSelection(selected, step).some((path, index) => path !== railOrder[index])
              }
              onMove={(selected, step) => {
                const next = moveSelection(selected, step);
                commitProjectRailOrder(next);
              }}
              onRemove={
                onRemoveProject
                  ? async (paths) => {
                      // Delete the active project last so its fallback is outside the selection.
                      const ordered = [...paths].sort(
                        (a, b) => Number(sameProjectPath(a, cwd)) - Number(sameProjectPath(b, cwd)),
                      );
                      for (const path of ordered) await onRemoveProject(path, { purgeData: true });
                    }
                  : undefined
              }
            >
              <div
                ref={(el) => {
                  lockOverscroll(el);
                  scrollRef.current = el;
                }}
                className={`bycoda-project-ledger flex flex-1 flex-col overflow-y-auto overscroll-none pb-2 ${navigator ? "min-h-0" : "min-h-32 [@container_rail_(max-height:640px)]:flex-none [@container_rail_(max-height:640px)]:overflow-y-visible"}`}
              >
                {/* The popup has one scroll owner: its live summary scrolls with the list. */}
                {navigator ? <div className="bycoda-rail-status">{liveStatus}</div> : null}
                {rail.order.map((id) => (
                  <Fragment key={id}>{sectionNodes[id]}</Fragment>
                ))}
              </div>
            </ProjectMultiSelect>
            {!navigator ? (
              <>
                <div className="shrink-0 px-2 @max-[140px]/rail:hidden">
                  <SidebarUpdateFooter
                    noticesOnly
                    update={updateNotice}
                    onOpenWhatsNew={onOpenWhatsNew}
                    onDismissUpdate={onDismissUpdate}
                  />
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
      {!navigator && !settingsOpen ? (
        <nav
          aria-label={t("Account")}
          className="bycoda-rail-tools bycoda-rail-tools--footer @container/rail shrink-0"
        >
          <div className="@max-[140px]/rail:hidden">
            <SidebarAccountFooter
              onOpenSettings={onOpenSettings}
              onOpenAccountSettings={openAccountSettings}
            />
          </div>
          <div className="hidden @max-[140px]/rail:block">
            <SidebarAccountFooter
              compact
              onOpenSettings={onOpenSettings}
              onOpenAccountSettings={openAccountSettings}
            />
          </div>
        </nav>
      ) : null}
      {visible ? projectMenu.element : null}
      {visible ? rail.element : null}
      {visible && inboxMenu ? (
        <InboxNotificationMenu
          {...inboxMenu}
          projectPaths={[...railProjectKeys]}
          onOpenSettings={onOpenNotificationSettings}
          onClose={() => {
            setInboxMenu(null);
            menuTrigger.current?.focus();
          }}
        />
      ) : null}
      {resizable && !navigator ? (
        <Sash
          {...resize.sashProps}
          label={t("Resize project sidebar")}
          appearance="hidden"
          className="absolute inset-y-0 end-0"
        />
      ) : null}
    </nav>
  );
}

type SortableHandle = ReturnType<typeof useAnimatedReorder>;

function ProjectSection({
  label,
  collapsed = false,
  onToggleCollapsed,
  items,
  muteStatuses,
  nameCollisions,
  focusHint,
  emptyLabel,
  onAdd,
  remoteOnly,
  onOpenSynced,
  cwd,
  busy,
  statsEnabled,
  sortable,
  drag,
  pinned,
  searchActive,
  onSelect,
  onTogglePin,
  onContextMenu,
  onOpenMenu,
  groupLabels,
  groupColors,
  groupCustomColors,
  groupLogos,
  groupMascots,
}: {
  label: string;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  items: RecentProject[];
  muteStatuses: ReadonlyMap<string, string | null>;
  nameCollisions: ReadonlySet<string>;
  /** Rows show their full detail in the shared keyboard-focus hint (not inside the Projects flyout). */
  focusHint: boolean;
  emptyLabel?: string;
  onAdd?: () => void;
  remoteOnly?: readonly RemoteOnlyProject[];
  onOpenSynced?: (projectId: string, name: string) => void | Promise<void>;
  cwd: string;
  busy: Set<string>;
  statsEnabled: boolean;
  sortable: SortableHandle;
  /** Moves the whole section; its body hides while any section is dragged. */
  drag: RailSectionDrag;
  pinned: boolean;
  searchActive: boolean;
  onSelect: (path: string) => void;
  onTogglePin: (path: string) => void;
  onContextMenu: (
    path: string,
    event: MouseEvent<HTMLElement>,
    onSelectForBulk?: () => void,
  ) => void;
  onOpenMenu: (path: string, x: number, y: number, onSelectForBulk?: () => void) => void;
  groupLabels: Record<string, string>;
  groupColors: Record<string, number>;
  groupCustomColors: Record<string, string>;
  groupLogos: ReturnType<typeof useTabGroupLogos>;
  groupMascots: Record<string, string>;
}) {
  useLocale();
  const { setRef } = drag;
  return (
    <div ref={setRef} className={RAIL_SECTION_BLOCK} data-collapsed={collapsed || undefined}>
      <ProjectSectionHeader
        label={label}
        onAdd={onAdd}
        drag={drag}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
      />
      {items.length === 0 && emptyLabel && !drag.folded && !collapsed ? (
        <Text
          as="p"
          size="caption"
          tone="secondary"
          leading="tight"
          className="px-4 pb-1 @max-[140px]/rail:hidden"
        >
          {emptyLabel}
        </Text>
      ) : null}
      <div
        hidden={drag.folded || collapsed}
        className={`flex-col gap-px px-2 ${drag.folded || collapsed ? "hidden" : "flex"}`}
      >
        {items.map((item) => (
          <ProjectCard
            key={item.path}
            item={item}
            muteStatus={muteStatuses.get(pathKey(item.path)) ?? undefined}
            nameCollisions={nameCollisions}
            focusHint={focusHint}
            selected={!searchActive && sameProjectPath(item.path, cwd)}
            busy={isBusyPath(item.path, busy)}
            statsEnabled={statsEnabled}
            pinned={pinned}
            sortable={sortable}
            onSelect={onSelect}
            onTogglePin={onTogglePin}
            onContextMenu={onContextMenu}
            onOpenMenu={onOpenMenu}
            groupLabels={groupLabels}
            groupColors={groupColors}
            groupCustomColors={groupCustomColors}
            groupLogos={groupLogos}
            groupMascots={groupMascots}
          />
        ))}
        {onOpenSynced && remoteOnly ? (
          <RemoteProjectSuggestions projects={remoteOnly} onOpen={onOpenSynced} />
        ) : null}
      </div>
    </div>
  );
}

function RemoteProjectSuggestions({
  projects,
  onOpen,
}: {
  projects: readonly RemoteOnlyProject[];
  onOpen: (projectId: string, name: string) => void | Promise<void>;
}) {
  const t = useT();
  const [stored, setStored] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const order = projects.map((project) => project.projectId);
  const chosen = order.filter((id) => stored.has(pathKey(id)));
  const active = chosen.length > 0;
  const clear = () => {
    setStored(new Set());
    anchor.current = null;
    setMenu(null);
  };
  const toggle = (id: string, range: boolean) => {
    const previousAnchor = anchor.current;
    setStored((current) =>
      selectProjectRange(
        order,
        !active && previousAnchor != null && order.includes(previousAnchor)
          ? new Set([pathKey(previousAnchor)])
          : current,
        previousAnchor,
        id,
        range,
      ),
    );
    if (!range || anchor.current == null) anchor.current = id;
  };
  return (
    <>
      {projects.map((project) => (
        <RemoteProjectSuggestion
          key={project.projectId}
          project={project}
          selected={stored.has(pathKey(project.projectId))}
          onOpen={(id, name) => {
            anchor.current = id;
            return onOpen(id, name);
          }}
          onClick={(event) => {
            if (!active && !event.ctrlKey && !event.metaKey && !event.shiftKey) return false;
            toggle(project.projectId, event.shiftKey);
            return true;
          }}
          onMenu={(x, y) =>
            setMenu({
              x,
              y,
              ids: stored.has(pathKey(project.projectId)) ? chosen : [project.projectId],
            })
          }
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              clear();
            } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
              event.preventDefault();
              setStored(new Set(order.map(pathKey)));
            }
          }}
        />
      ))}
      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          items={[
            { kind: "item", id: "select", label: t("Select") },
            { kind: "item", id: "all", label: t("Select all") },
            { kind: "item", id: "clear", label: t("Clear selection"), disabled: !active },
            { kind: "sep" },
            {
              kind: "item",
              id: "remove",
              label: t("Remove"),
              description: t("Remove from this desktop only"),
            },
          ]}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            if (id === "remove") {
              dismissRemoteProjects(menu.ids);
              const removed = new Set(menu.ids.map(pathKey));
              setStored((current) => new Set([...current].filter((key) => !removed.has(key))));
              if (anchor.current != null && removed.has(pathKey(anchor.current)))
                anchor.current = null;
            } else if (id === "all") setStored(new Set(order.map(pathKey)));
            else if (id === "clear") clear();
            else if (id === "select") {
              setStored((current) => new Set([...current, ...menu.ids.map(pathKey)]));
              anchor.current = menu.ids[0];
            }
            setMenu(null);
          }}
        />
      ) : null}
    </>
  );
}

function RemoteProjectSuggestion({
  project,
  onOpen,
  selected,
  onClick,
  onMenu,
  onKeyDown,
}: {
  project: RemoteOnlyProject;
  onOpen: (projectId: string, name: string) => void | Promise<void>;
  selected: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => boolean;
  onMenu: (x: number, y: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const t = useT();
  const openTargets = useRemoteOpenTargets();
  const match = remoteOpenMatchIn(project, openTargets);
  return (
    <>
      <Button
        variant="item"
        size="sm"
        selected={selected}
        type="button"
        data-remote-project-id={project.projectId}
        data-multi-selected={selected || undefined}
        aria-pressed={selected}
        tooltip={project.name}
        tooltipDetails={[remoteOnlyProjectHint(project, match)]}
        tooltipSide="right"
        tooltipWide
        aria-label={
          match
            ? t("{p0}, on {p1}. Open there", { p0: project.name, p1: match.target.name })
            : t("{p0}, on a machine that is not connected", { p0: project.name })
        }
        onClick={(event) => {
          if (!onClick(event)) void onOpen(project.projectId, project.name);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onMenu(event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          onKeyDown(event);
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu(rect.left, rect.bottom);
        }}
        className="flex min-w-0 select-none items-center gap-2 text-left @max-[140px]/rail:justify-center"
      >
        {selected ? (
          <Check className="icon-md shrink-0" strokeWidth={1.75} />
        ) : (
          <LinkIcon className="icon-md shrink-0" strokeWidth={1.75} />
        )}
        <Text
          as="span"
          truncate
          size="secondary"
          tone="inherit"
          weight="medium"
          leading="tight"
          className={nameClassName}
        >
          {project.name}
        </Text>
      </Button>
    </>
  );
}

function ProjectSectionHeader({
  label,
  drag,
  collapsed = false,
  onToggleCollapsed,
  onAdd,
  onAddGroup,
}: {
  label: string;
  drag: RailSectionDrag;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onAdd?: () => void;
  onAddGroup?: (x: number, y: number) => void;
}) {
  const t = useT();
  return (
    <RailSectionHeader
      label={label}
      drag={drag}
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      actions={
        <>
          {onAddGroup ? (
            <InlineAction
              reveal="always"
              label={t("New project group")}
              motion="none"
              type="button"
              data-no-drag
              aria-label={t("New project group")}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onAddGroup(rect.left, rect.bottom);
              }}
              className="shrink-0"
            >
              <FolderPlus className="icon-sm" strokeWidth={1.75} />
            </InlineAction>
          ) : null}
          {onAdd ? <AddProjectButton onOpenFolder={onAdd} /> : null}
        </>
      }
    />
  );
}

function ProjectGroupSection({
  group,
  revealed = false,
  children,
  workspaceIds = [],
  items,
  workspaceItems,
  muteStatuses,
  nameCollisions,
  focusHint,
  cwd,
  busy,
  statsEnabled,
  searchActive,
  onSelect,
  onContextMenu,
  onOpenMenu,
  onReorder,
  onToggleCollapsed,
  onToggleLock,
  onOpenGroupMenu,
  locked,
  sortableGroups,
  groupLabels,
  groupColors,
  groupCustomColors,
  groupLogos,
  groupMascots,
}: {
  group: ProjectGroup;
  /** Shown open because the active project is inside, whatever the saved collapsed state. */
  revealed?: boolean;
  /** Renders one nested workspace; it reorders with the group's projects in one list. */
  children?: (id: string, sortable: SortableHandle) => ReactNode;
  workspaceIds?: string[];
  /** Locked groups get no items: only the name and the padlock show. */
  locked: boolean;
  /** Orders the groups; the header is the drag handle. */
  sortableGroups: SortableHandle;
  items: RecentProject[];
  workspaceItems: RecentProject[];
  muteStatuses: ReadonlyMap<string, string | null>;
  nameCollisions: ReadonlySet<string>;
  /** Rows show their full detail in the shared keyboard-focus hint (not inside the Projects flyout). */
  focusHint: boolean;
  cwd: string;
  busy: Set<string>;
  statsEnabled: boolean;
  searchActive: boolean;
  onSelect: (path: string) => void;
  onContextMenu: (
    path: string,
    event: MouseEvent<HTMLElement>,
    onSelectForBulk?: () => void,
  ) => void;
  onOpenMenu: (path: string, x: number, y: number, onSelectForBulk?: () => void) => void;
  onReorder: (ids: string[]) => void;
  onToggleCollapsed: () => void;
  onToggleLock: () => void;
  onOpenGroupMenu: (x: number, y: number, onOpenGitOverview?: () => void) => void;
  groupLabels: Record<string, string>;
  groupColors: Record<string, number>;
  groupCustomColors: Record<string, string>;
  groupLogos: ReturnType<typeof useTabGroupLogos>;
  groupMascots: Record<string, string>;
}) {
  const t = useT();
  const headerBackground = useRailBackground(group.id, "header");
  const bodyBackground = useRailBackground(group.id, "body");
  const { members, sortable } = useProjectGroupMembers(
    group,
    items.map((item) => item.path),
    workspaceIds,
    onReorder,
    (path) => resolveTabGroupLabel(projectKey(path), groupLabels, basename(path)),
  );
  const itemByPath = new Map(items.map((item) => [item.path, item]));
  const memberCount = items.length + workspaceIds.length;
  const countLabel = `${memberCount} ${memberCount === 1 ? "project" : "projects"}`;
  const expanded = (!group.collapsed || revealed) && !locked;
  const collapsed = !expanded;
  // While any group is dragged, every group shows only its header.
  const folded = sortableGroups.draggingId !== null;
  const showBody = expanded && !folded;
  const { viewportRef, contentRef, settledOpen } = useCollapsibleHeight(showBody, folded || locked);
  // Keep rows alive for the closing transition, then release their subscriptions.
  const [retainedBody, releaseRetainedBody] = useRetainedWhileClosing(
    expanded,
    COLLAPSE_DURATION_MS + 100,
  );
  const renderBody = !locked && retainedBody;
  const linkStatus = useLinkedGroupStatus(group.id);
  const workspaceRoot = projectGroupWorkspaceRoot(group);
  const workspaceSelected = !!workspaceRoot && !searchActive && sameProjectPath(workspaceRoot, cwd);
  const localPaths = items.map((item) => item.path).filter(isLocalProject);
  // Share card stats, but wait until opening settles before starting subscriptions.
  const groupStats = useProjectsDiffStats(localPaths, statsEnabled && settledOpen);
  const gitSummary = summarizeGroupGit(
    localPaths.map((_, index) => ({
      remote: false,
      files: groupStats[index]?.files ?? null,
    })),
  );
  const [overviewOpen, setOverviewOpen] = useState(false);
  const gitAnchor = useRef<HTMLButtonElement>(null);
  const groupOptionsAnchor = useRef<HTMLButtonElement>(null);
  const [overviewFromMenu, setOverviewFromMenu] = useState(false);
  const gitTitle =
    gitSummary.known > 0
      ? `${gitSummary.dirty} of ${gitSummary.local} ${gitSummary.local === 1 ? "project has" : "projects have"} uncommitted changes`
      : "Git overview";
  const openGitOverview = (fromMenu = false) => {
    if (workspaceRoot)
      window.dispatchEvent(new CustomEvent(OPEN_PROJECT_CHANGES_EVENT, { detail: workspaceRoot }));
    else {
      setOverviewFromMenu(fromMenu);
      setOverviewOpen(true);
    }
  };
  const openMenu = (target: HTMLElement, x?: number, y?: number) => {
    const rect = target.getBoundingClientRect();
    onOpenGroupMenu(
      x ?? rect.left,
      y ?? rect.bottom,
      !locked && (localPaths.length > 0 || !!workspaceRoot)
        ? () => openGitOverview(true)
        : undefined,
    );
  };

  return (
    <div
      ref={(el) => sortableGroups.setItemRef(group.id, el)}
      className={`reorder-item rail-reorder-block project-group-section shrink-0 overflow-hidden rounded-md ${
        showBody ? "mb-1.5" : ""
      }`}
      data-project-group={group.id}
      data-workspace-root={workspaceRoot ?? undefined}
      data-folded={folded || undefined}
      role="group"
      aria-label={group.name}
    >
      <ActionHost
        selected={workspaceSelected}
        hoverReveal
        tone="primary"
        data-group-row
        data-group-overview-open={overviewOpen || undefined}
        className={`project-reorder-item group relative flex h-(--ui-control-height-compact) items-stretch rounded-md px-2 @max-[140px]/rail:px-0 ${RAIL_DRAG_HANDLE}`}
        ground={railBackgroundColor(headerBackground)}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
            return;
          }
          sortableGroups.onItemPointerDown(group.id, event);
        }}
        // The click that ends a drag must not expand, collapse or unlock.
        onClickCapture={(event) => {
          if (!sortableGroups.consumeClick()) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button, [data-no-drag]")) return;
          onToggleCollapsed();
        }}
        // Alt+Up / Alt+Down moves the group among its siblings, announced like a drag.
        onKeyDown={(event) => {
          sortableGroups.onItemKeyDown(group.id, event);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();
          openMenu(event.currentTarget, event.clientX, event.clientY);
        }}
      >
        <Button
          iconOnly
          label={locked ? t("{p0}, locked", { p0: group.name }) : `${group.name}, ${countLabel}`}
          variant="ghost"
          motion="none"
          type="button"
          aria-expanded={expanded}
          aria-label={
            locked ? t("{p0}, locked", { p0: group.name }) : `${group.name}, ${countLabel}`
          }
          tooltip={group.name}
          tooltipDetails={[locked ? t("Locked") : countLabel]}
          onClick={onToggleCollapsed}
          className="size-6 shrink-0 @max-[140px]/rail:flex-1"
        >
          <div className="grid size-4 shrink-0 place-items-center">
            {collapsed ? (
              <>
                <span
                  data-group-mascot
                  className="grid size-4 place-items-center group-hover:hidden group-has-[button:focus-visible]:hidden"
                >
                  <ProjectMascot
                    project={group.id}
                    color={projectGroupColor(group)}
                    name={group.mascot ?? null}
                    className="size-3"
                  />
                </span>
                <ChevronRight
                  data-group-chevron
                  className="icon-sm hidden group-hover:block group-has-[button:focus-visible]:block"
                  strokeWidth={1.75}
                />
              </>
            ) : (
              <ChevronDown data-group-chevron className="icon-sm" strokeWidth={1.75} />
            )}
          </div>
        </Button>
        {/* The name keeps a readable minimum while hover reveals the group actions beside it. */}
        <div
          data-group-labels
          className="flex min-w-0 flex-1 items-center gap-1.5 @max-[140px]/rail:hidden"
        >
          {workspaceRoot && !locked ? (
            <Button
              variant="ghost"
              selected={workspaceSelected}
              data-action-primary
              motion="none"
              type="button"
              aria-label={t("Open {p0}", { p0: group.name })}
              aria-current={workspaceSelected ? "page" : undefined}
              tooltip={group.name}
              tooltipDetails={[workspaceRoot]}
              tooltipWide
              // The name is part of the drag handle; the click that ends a drag is swallowed above.
              onClick={() => onSelect(workspaceRoot)}
              size="sm"
              // With its 1px border, this starts the name where a plain group's `ps-1` label does.
              className="min-w-8 flex-1 justify-start ps-1 text-left"
            >
              <Text
                as="span"
                truncate
                size="secondary"
                tone="inherit"
                weight="medium"
                leading="tight"
                className={nameClassName}
              >
                {group.name}
              </Text>
            </Button>
          ) : (
            <Text
              as="span"
              truncate
              size="secondary"
              tone="inherit"
              weight="medium"
              leading="tight"
              className={`${nameClassName} ps-1`}
            >
              {group.name}
            </Text>
          )}
          {group.workspaceFile && !locked ? (
            <Tooltip label={t("Workspace")}>
              <Text
                role="img"
                aria-label={t("Workspace")}
                data-group-workspace-mark
                size="inherit"
                tone="secondary"
                className="grid size-4 shrink-0 place-items-center @max-[200px]/rail:hidden"
              >
                <FolderTree className="icon-xs" strokeWidth={1.75} aria-hidden="true" />
              </Text>
            </Tooltip>
          ) : null}
          {group.workspaceFile && !locked && linkStatus ? (
            <Tooltip
              label={t("{p0}\nThe group was left as it is.", { p0: linkStatus.message })}
              wide
            >
              <Text
                role="img"
                aria-label={t("Linked workspace file problem: {p0}", { p0: linkStatus.message })}
                size="inherit"
                tone="warning"
                className="grid size-4 shrink-0 place-items-center @max-[140px]/rail:hidden"
              >
                <AlertCircle className="icon-xs" strokeWidth={1.75} aria-hidden="true" />
              </Text>
            </Tooltip>
          ) : null}
        </div>
        {/* Status shares the trailing column with hover actions. */}
        {gitSummary.dirty > 0 ? (
          <Tooltip label={group.name} details={[gitTitle]}>
            <Badge
              variant="count"
              size="xs"
              data-group-git
              className="my-auto shrink-0 @max-[140px]/rail:hidden"
            >
              {gitSummary.dirty}
            </Badge>
          </Tooltip>
        ) : null}
        <div
          data-group-actions
          className="my-auto flex shrink-0 items-center gap-0.5 @max-[140px]/rail:hidden!"
        >
          <div data-action-slot="collapse" className="flex items-center gap-0.5">
            {group.workspaceFile && !locked && !linkStatus ? (
              <Tooltip label={t("Linked to {p0}", { p0: group.workspaceFile })} wide>
                <Text
                  role="img"
                  aria-label={t("Linked to {p0}", { p0: group.workspaceFile })}
                  size="inherit"
                  tone="secondary"
                  className="grid size-5 shrink-0 place-items-center"
                >
                  <File className="icon-xs" strokeWidth={1.75} aria-hidden="true" />
                </Text>
              </Tooltip>
            ) : null}
            {localPaths.length > 0 || (workspaceRoot && !locked) ? (
              <InlineAction
                label={t("{p0} git overview, {p1}", { p0: group.name, p1: gitTitle })}
                tooltip={group.name}
                tooltipDetails={[gitTitle]}
                ref={gitAnchor}
                motion="none"
                type="button"
                data-no-drag
                aria-label={t("{p0} git overview, {p1}", { p0: group.name, p1: gitTitle })}
                aria-haspopup={workspaceRoot ? undefined : "dialog"}
                aria-expanded={workspaceRoot ? undefined : overviewOpen}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  if (overviewOpen) setOverviewOpen(false);
                  else openGitOverview();
                }}
                className="shrink-0"
              >
                <GitBranch className="icon-xs" strokeWidth={1.75} />
              </InlineAction>
            ) : null}
            <InlineAction
              label={
                locked ? t("Unlock {p0}", { p0: group.name }) : t("Lock {p0}", { p0: group.name })
              }
              tooltip={locked ? t("Unlock…") : t("Lock group")}
              tooltipDetails={[group.name]}
              motion="none"
              type="button"
              data-no-drag
              aria-label={
                locked ? t("Unlock {p0}", { p0: group.name }) : t("Lock {p0}", { p0: group.name })
              }
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onToggleLock();
              }}
              className="shrink-0"
            >
              {locked ? (
                <Lock className="icon-sm" strokeWidth={1.75} />
              ) : (
                <LockOpen className="icon-sm" strokeWidth={1.75} />
              )}
            </InlineAction>
          </div>
          <InlineAction
            ref={groupOptionsAnchor}
            label={t("{p0} group options", { p0: group.name })}
            tooltip={t("Group options")}
            tooltipDetails={[group.name]}
            motion="none"
            type="button"
            data-no-drag
            aria-label={t("{p0} group options", { p0: group.name })}
            aria-haspopup="menu"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              openMenu(event.currentTarget);
            }}
            className="shrink-0"
          >
            <MoreHorizontal className="icon-md" strokeWidth={1.75} />
          </InlineAction>
        </div>
        {overviewOpen && !locked && !workspaceRoot ? (
          <GroupGitPopover
            anchor={overviewFromMenu ? groupOptionsAnchor : gitAnchor}
            name={group.name}
            paths={workspaceItems.map((item) => item.path)}
            onSelect={(path) => {
              setOverviewOpen(false);
              window.dispatchEvent(new CustomEvent(OPEN_PROJECT_CHANGES_EVENT, { detail: path }));
            }}
            onDismiss={() => setOverviewOpen(false)}
          />
        ) : null}
      </ActionHost>
      <div
        ref={viewportRef}
        className="project-group-body"
        data-open={showBody}
        data-folded={folded || undefined}
        aria-hidden={!showBody}
        inert={!showBody}
        onTransitionEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            event.propertyName === "height" &&
            !expanded
          ) {
            releaseRetainedBody();
          }
        }}
      >
        <div ref={contentRef} className="project-group-body-clip">
          {renderBody ? (
            <div
              data-project-group-items
              // Members sit indented under the header, on a guide line below its chevron.
              className="relative flex flex-col gap-0 p-1 ps-5 before:absolute before:inset-y-1 before:start-5 before:w-px before:bg-(--ui-pane-border) @max-[140px]/rail:ps-1 @max-[140px]/rail:before:hidden"
              style={{ backgroundColor: railBackgroundColor(bodyBackground) }}
            >
              {members.map(({ kind, id }) => {
                const item = itemByPath.get(id);
                if (kind === "group" || !item) return children?.(id, sortable);
                return (
                  <ProjectCard
                    key={item.path}
                    item={item}
                    muteStatus={muteStatuses.get(pathKey(item.path)) ?? undefined}
                    nameCollisions={nameCollisions}
                    focusHint={focusHint}
                    selected={!searchActive && sameProjectPath(item.path, cwd)}
                    busy={isBusyPath(item.path, busy)}
                    statsEnabled={statsEnabled && settledOpen}
                    sortable={sortable}
                    onSelect={onSelect}
                    onContextMenu={onContextMenu}
                    onOpenMenu={onOpenMenu}
                    groupLabels={groupLabels}
                    groupColors={groupColors}
                    groupCustomColors={groupCustomColors}
                    groupLogos={groupLogos}
                    groupMascots={groupMascots}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const nameClassName = "min-w-0 flex-1 @max-[140px]/rail:hidden";

function ProjectCard({
  item,
  muteStatus,
  selected,
  busy,
  statsEnabled,
  pinned,
  sortable,
  onSelect,
  onTogglePin,
  onContextMenu,
  onOpenMenu,
  groupLabels,
  groupColors,
  groupCustomColors,
  groupLogos,
  groupMascots,
  nameCollisions,
  focusHint,
}: {
  item: RecentProject;
  muteStatus?: string;
  selected: boolean;
  busy: boolean;
  statsEnabled: boolean;
  /** Group members leave both out: only ungrouped projects can be pinned. */
  pinned?: boolean;
  sortable: SortableHandle;
  onSelect: (path: string) => void;
  onTogglePin?: (path: string) => void;
  onContextMenu: (
    path: string,
    event: MouseEvent<HTMLElement>,
    onSelectForBulk?: () => void,
  ) => void;
  onOpenMenu: (path: string, x: number, y: number, onSelectForBulk?: () => void) => void;
  groupLabels: Record<string, string>;
  groupColors: Record<string, number>;
  groupCustomColors: Record<string, string>;
  groupLogos: ReturnType<typeof useTabGroupLogos>;
  groupMascots: Record<string, string>;
  /** Display names several rail projects share; such a row adds its parent folder as context. */
  nameCollisions: ReadonlySet<string>;
  /** Rows show their full detail in the shared keyboard-focus hint (not inside the Projects flyout). */
  focusHint: boolean;
}) {
  const t = useT();
  const multi = useProjectMultiSelect();
  const multiSelected = multi?.selected.has(pathKey(item.path)) ?? false;
  const fallbackName = basename(item.path);
  const key = projectKey(item.path);
  const seed = projectName(item.path);
  const name = resolveTabGroupLabel(key, groupLabels, fallbackName);
  const headerBackground = useRailBackground(key, "header");
  const logoPath = useProjectLogoPath(key, groupLogos, groupMascots);
  const color = resolveTabGroupColor(key, groupColors, groupCustomColors, seed);
  const diffEnabled = statsEnabled && Boolean(item.path) && item.path !== "~";
  const stats = useProjectDiffStats(item.path, diffEnabled, selected);
  // No read (or a failed one) is `null`, never "clean"; a clean tree shows nothing either.
  const change = projectGitChange(stats);
  const remote = useRemoteProject(item.path);
  const { machines } = useRemoteMachines(!!remote);
  const machine = remote
    ? machines.find((entry) => entry.environmentId === remote.environmentId)
    : undefined;
  // Keeps the machine checked while its row is on screen; the shared
  // connection status below is what the row shows.
  useRemoteMachineOnline(machine?.id);
  const remoteConnection = useRemoteConnection(item.path);
  const indicator = connectionIndicator(remoteConnection, remoteConnection.reconnecting);
  const reconnectable = !!machine && indicator.tone === "down";
  const showReconnect = reconnectable || remoteConnection.reconnecting;
  const connection = !remote
    ? ""
    : !machine
      ? "Machine not connected on this computer"
      : indicator.label;
  // The row's second label tells same-named projects apart: the machine for a remote project, the parent
  // folder for a local project whose name another rail project shares. The stored name never changes.
  const hostLabel = machine ? machineLabel(machines, machine) : "";
  // A remote project never prints the host inline: the right-hand globe carries it in its tooltip and label.
  const context =
    !remote && isDuplicateProjectName(nameCollisions, name) ? parentFolderLabel(item.path) : "";
  const changeSummary = change ? projectGitChangeSummary(change, t) : "";
  // The tooltip shows on hover and on keyboard focus: the name, then the path and state as muted lines.
  const rowTipDetails = [
    remote ? `${remote.cwd} on ${hostLabel || "another machine"} (${connection})` : item.path,
    busy && t("Working"),
    change && t("{p0} uncommitted", { p0: changeSummary }),
    muteStatus,
  ];
  const cardAriaLabel = [
    machine ? `${name} on ${hostLabel}` : context ? `${name} (${context})` : name,
    busy ? "working" : "",
    change ? projectGitChangeSpoken(change, t) : "",
    muteStatus,
  ]
    .filter(Boolean)
    .join(", ");
  const labelClassName = context ? "min-w-0 max-w-[75%] @max-[140px]/rail:hidden" : nameClassName;
  // The wide "+a -d" needs room: the compact indicator replaces it once the row itself is narrower than
  // this bucket (see projectRailRow.css). Fixed items sharing the row make the detail need more.
  const detailBucket = change
    ? projectGitDetailBucket(
        change,
        (remote && !showReconnect ? 1 : 0) + (muteStatus ? 1 : 0) + (showReconnect ? 1 : 0),
      )
    : null;

  return (
    <ActionHost
      ref={(el) => sortable.setItemRef(item.path, el)}
      selected={selected || multiSelected}
      hoverReveal
      tone="primary"
      data-project-path={item.path}
      ground={railBackgroundColor(headerBackground)}
      data-project-working={busy || undefined}
      data-multi-selected={multiSelected || undefined}
      data-project-row=""
      className="reorder-item project-reorder-item group relative flex h-(--ui-control-height-compact) cursor-default touch-none items-stretch rounded-md px-2 @max-[140px]/rail:px-0"
      onPointerDown={(event) => {
        if (multi?.active || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.button !== 0) return;
        if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
          return;
        }
        sortable.onItemPointerDown(item.path, event);
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
          return;
        }
        if (sortable.consumeClick()) return;
        if (multi && (multi.active || event.ctrlKey || event.metaKey || event.shiftKey)) {
          multi.toggle(item.path, event.shiftKey, event.ctrlKey || event.metaKey || event.shiftKey);
          return;
        }
        multi?.rememberAnchor(item.path);
        onSelect(item.path);
      }}
      onContextMenu={(event) => {
        if (multi?.active && multiSelected) {
          event.preventDefault();
          event.stopPropagation();
          multi.openActions(event.currentTarget, { x: event.clientX, y: event.clientY });
        } else
          onContextMenu(
            item.path,
            event,
            multi && item.path !== "~" ? () => multi.toggle(item.path) : undefined,
          );
      }}
      onKeyDown={(event) => {
        // Alt+Arrow moves the row without dragging; bulk selection has its own move actions.
        if (
          !multi?.active &&
          !(event.target as HTMLElement | null)?.closest("[data-no-drag]") &&
          sortable.onItemKeyDown(item.path, event)
        )
          return;
        if (multi?.active && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
          event.preventDefault();
          multi.selectAll();
          return;
        }
        if (event.key === "Escape" && multi?.active) {
          event.preventDefault();
          multi.clear();
          return;
        }
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        if (multi?.active && multiSelected) multi.openActions(event.currentTarget);
        else
          onOpenMenu(
            item.path,
            rect.left,
            rect.bottom,
            multi && item.path !== "~" ? () => multi.toggle(item.path) : undefined,
          );
      }}
    >
      {multi?.active ? (
        <span className="my-auto shrink-0 [margin-inline-end:0.5rem]">
          <Checkbox
            data-no-drag
            checked={multiSelected}
            aria-label={t("Select {p0}", { p0: name })}
            onClick={(event) => {
              event.stopPropagation();
              multi.toggle(item.path, event.shiftKey);
            }}
            onChange={() => {}}
          />
        </span>
      ) : null}
      <Button
        data-project-primary
        variant="item"
        type="button"
        tooltip={name}
        tooltipDetails={rowTipDetails}
        tooltipSide="right"
        tooltipWide
        // The flyout focuses a row as it opens; a focus hint there would pop over the list. Button
        // skips its focus hint when the handler prevents the event's default.
        onFocus={focusHint ? undefined : (event) => event.preventDefault()}
        aria-label={cardAriaLabel}
        aria-current={selected ? "true" : undefined}
        className={`project-card-primary flex min-w-0 flex-1 cursor-default items-center gap-2 border-0 ps-1 text-left ${showReconnect ? "pe-7" : "pe-0"} @max-[140px]/rail:justify-center @max-[140px]/rail:px-0!`}
      >
        <div
          data-project-pinnable={!multi?.active && !!onTogglePin ? "" : undefined}
          className="project-card-logo grid size-4 shrink-0 place-items-center @max-[140px]/rail:opacity-100!"
        >
          {logoPath && !busy ? (
            <ProjectLogoIcon
              path={logoPath}
              className="size-4 rounded-sm"
              imageClassName="size-4"
            />
          ) : (
            <ProjectMascot
              project={seed}
              color={color}
              name={resolveTabGroupMascot(key, groupMascots)}
              className="size-3.5"
              active={busy}
            />
          )}
        </div>
        {busy ? (
          <span
            data-project-working-indicator
            role="img"
            aria-label={t("Working")}
            className="shrink-0 @max-[140px]/rail:hidden"
          >
            <TerminalSpinner />
          </span>
        ) : null}
        <Text
          as="span"
          truncate
          size="secondary"
          tone="inherit"
          weight="medium"
          leading="tight"
          className={labelClassName}
        >
          {name}
        </Text>
        {context ? (
          <Text
            size="caption"
            tone="secondary"
            leading="tight"
            truncate
            className="project-card-context min-w-0 flex-1 @max-[140px]/rail:hidden"
          >
            {context}
          </Text>
        ) : null}
        <span className="ms-auto flex min-w-0 shrink-0 items-center gap-1 @max-[140px]/rail:hidden">
          {remote && !showReconnect ? (
            <Text
              role="img"
              aria-label={connection}
              size="inherit"
              tone="secondary"
              className="relative grid size-4 shrink-0 place-items-center @max-[140px]/rail:hidden"
            >
              <Internet className="icon-xs" strokeWidth={1.75} aria-hidden="true" />
              <StatusDot
                label={connection}
                aria-hidden="true"
                tone={
                  indicator.tone === "connected"
                    ? "success"
                    : indicator.tone === "connecting"
                      ? "warning"
                      : "danger"
                }
                className="absolute right-0 bottom-0"
              />
            </Text>
          ) : null}
          {muteStatus ? (
            <Text
              role="img"
              aria-label={muteStatus}
              size="inherit"
              tone="warning"
              className="grid size-4 shrink-0 place-items-center @max-[140px]/rail:hidden"
            >
              <BellOff className="icon-sm" strokeWidth={1.75} aria-hidden="true" />
            </Text>
          ) : null}
          {change ? (
            <span
              className="project-card-stats shrink-0 @max-[140px]/rail:hidden!"
              data-project-git=""
              data-git-bucket={detailBucket ?? undefined}
            >
              <ProjectGitChangeMark change={change} />
            </span>
          ) : null}
        </span>
      </Button>
      {change ? (
        // The wrapper hides the dot outside the icon rail: StatusDot's own display beats `hidden`.
        <span className="pointer-events-none absolute right-1.5 top-1.5 hidden @max-[140px]/rail:flex">
          <StatusDot label={t("Changes")} aria-hidden />
        </span>
      ) : null}
      {!multi?.active ? (
        <>
          {showReconnect ? (
            <InlineAction
              reveal="always"
              label={t("{p0} Reconnect machine", { p0: connection })}
              motion="none"
              data-no-drag
              loading={remoteConnection.reconnecting}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void remoteConnection.reconnect({ signIn: true });
              }}
              className="absolute end-7 top-1/2 -translate-y-1/2 @max-[140px]/rail:hidden!"
            >
              <Internet className="icon-sm" strokeWidth={1.75} aria-hidden />
            </InlineAction>
          ) : null}
          <InlineAction
            data-project-options
            label={t("Project options")}
            tooltipDetails={[name]}
            motion="none"
            type="button"
            data-no-drag
            aria-label={t("Project options")}
            aria-haspopup="menu"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              onOpenMenu(
                item.path,
                event.detail === 0 ? rect.left : event.clientX,
                event.detail === 0 ? rect.bottom : event.clientY,
                multi && item.path !== "~" ? () => multi.toggle(item.path) : undefined,
              );
            }}
            className="absolute end-2 [inset-block-start:50%] -translate-y-1/2 @max-[140px]/rail:hidden!"
          >
            <MoreHorizontal className="icon-md" strokeWidth={1.75} />
          </InlineAction>
          {onTogglePin ? (
            <InlineAction
              data-project-pin
              label={pinned ? t("Unpin project") : t("Pin project")}
              tooltipDetails={[name]}
              motion="none"
              type="button"
              data-no-drag
              data-usage-guide="group-pin"
              aria-label={pinned ? t("Unpin project") : t("Pin project")}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePin(item.path);
              }}
              className="absolute start-2.5 [inset-block-start:50%] -translate-y-1/2 @max-[140px]/rail:hidden!"
            >
              {pinned ? (
                <PinOff className="icon-sm" strokeWidth={1.75} />
              ) : (
                <Pin className="icon-sm" strokeWidth={1.75} />
              )}
            </InlineAction>
          ) : null}
        </>
      ) : null}
    </ActionHost>
  );
}

/** The live-agent list as one mascot per agent, for the icon-only rail. */
function CompactLiveAgents({
  agents,
  activeSessionId,
  onSelect,
  groupLabels,
  groupColors,
  groupCustomColors,
  groupMascots,
}: {
  agents: LiveAgent[];
  activeSessionId?: string;
  onSelect?: (sessionId: string) => void;
  groupLabels: Record<string, string>;
  groupColors: Record<string, number>;
  groupCustomColors: Record<string, string>;
  groupMascots: Record<string, string>;
}) {
  const t = useT();
  if (!shouldShowLiveAgents(agents, activeSessionId)) return null;
  const summary = summarizeLiveAgents(agents);
  const { title: heading, count: headlineCount } = liveHeadline(summary, t);
  return (
    <section
      aria-label={t("{p0} agents", { p0: heading })}
      className="hidden shrink-0 flex-col items-center gap-0 px-2 pb-1 @max-[140px]/rail:flex"
    >
      <Tooltip label={heading} details={[String(headlineCount)]} side="right">
        <div
          role="img"
          aria-label={`${heading}, ${headlineCount}`}
          className="my-1 grid size-3 shrink-0 place-items-center"
        >
          {summary.headline === "attention" ? (
            <CircleAlert className="icon-xs" tone="warning" strokeWidth={1.75} />
          ) : (
            <StatusDot
              label={heading}
              aria-hidden
              tone={summary.working > 0 ? "accent" : "neutral"}
            />
          )}
        </div>
      </Tooltip>
      <div className="flex max-h-[30vh] w-full flex-col gap-0 overflow-y-auto overscroll-none">
        {agents.map((agent) => {
          const seed = projectName(agent.cwd);
          const key = projectKey(agent.cwd);
          const project = resolveTabGroupLabel(key, groupLabels, seed);
          const color = resolveTabGroupColor(key, groupColors, groupCustomColors, seed);
          const activity = agent.issue
            ? t(agent.issue === "retrying" ? "Retrying" : "Failed")
            : agent.needsApproval
              ? t(agent.inputKind === "question" ? "Question" : "Need approval")
              : agent.done
                ? "Done"
                : agent.waiting
                  ? t("Waiting")
                  : agent.activity;
          const parts = [agent.title, project, activity].filter(Boolean);
          return (
            <Button
              key={agent.id}
              variant="ghost"
              motion="none"
              iconOnly
              label={parts.join(", ")}
              size="sm"
              selected={agent.id === activeSessionId}
              type="button"
              tooltip={agent.title}
              tooltipDetails={[project, activity]}
              tooltipSide="right"
              tooltipWide
              aria-label={parts.join(", ")}
              aria-current={agent.id === activeSessionId ? "true" : undefined}
              onClick={() => onSelect?.(agent.id)}
              className="relative grid w-full shrink-0 place-items-center"
            >
              <ProjectMascot
                project={seed}
                color={color}
                name={resolveTabGroupMascot(key, groupMascots)}
                className="size-3"
                active={!agent.needsApproval && !agent.done && !agent.waiting}
              />
              {agent.needsApproval ? (
                <StatusDot
                  label={activity}
                  tone="warning"
                  aria-hidden
                  className="absolute right-1.5 top-1.5"
                />
              ) : null}
            </Button>
          );
        })}
      </div>
    </section>
  );
}

function isBusyPath(path: string, busy: Set<string>): boolean {
  for (const other of busy) {
    if (sameProjectPath(path, other)) return true;
  }
  return false;
}

/**
 * The row's Git change mark. Both forms are decorative: the row button's accessible name and tooltip carry
 * the full files and lines. The wide form shows "+a -d" (only when line counts exist); the compact form is
 * the shared Changes icon with the changed-file count, which is its own measure and never a line count.
 * CSS switches between them by the row's width (projectRailRow.css).
 */
function ProjectGitChangeMark({ change }: { change: ProjectGitChange }) {
  return (
    <>
      {change.hasLines ? (
        <DiffStat
          data-git-detail=""
          aria-hidden="true"
          additions={change.additions}
          deletions={change.deletions}
          size="micro"
          weight="medium"
          className="font-sans"
        />
      ) : null}
      <Text
        data-git-compact=""
        aria-hidden="true"
        size="inherit"
        tone="secondary"
        className="items-center gap-0.5"
      >
        <FileDiff className="icon-xs shrink-0" strokeWidth={1.75} />
        {change.files > 0 ? (
          <Badge data-git-count="" variant="count" size="xs">
            {projectGitCountLabel(change.files)}
          </Badge>
        ) : null}
      </Text>
    </>
  );
}

/** Adds a folder on this computer, or one on a connected machine. */
function AddProjectButton({ onOpenFolder }: { onOpenFolder: () => void }) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <InlineAction
        reveal="always"
        label={t("Open project")}
        motion="none"
        ref={anchor}
        type="button"
        data-no-drag
        aria-label={t("Open project")}
        data-usage-guide="project-add"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="shrink-0"
      >
        <Plus className="icon-sm" strokeWidth={1.75} />
      </InlineAction>
      {open ? (
        <DropdownMenu
          anchor={anchor}
          label={t("Open project")}
          align="start"
          width={290}
          returnFocusRef={anchor}
          onClose={() => setOpen(false)}
          onPick={(id) => {
            if (id === "folder") onOpenFolder();
            else window.dispatchEvent(new Event(id));
          }}
          items={[
            {
              kind: "item",
              id: "folder",
              label: t("Open folder…"),
              icon: <FolderPlus className="icon-sm" />,
            },
            {
              kind: "item",
              id: OPEN_CODE_WORKSPACE_EVENT,
              label: t("Open VS Code workspace…"),
              icon: <FolderPlus className="icon-sm" />,
            },
            {
              kind: "item",
              id: OPEN_REMOTE_PROJECT_EVENT,
              label: t("Open folder on a machine…"),
              icon: <Internet className="icon-sm" />,
            },
            {
              kind: "item",
              id: OPEN_SESSION_IMPORT_EVENT,
              label: t("Import Claude Code / Codex sessions…"),
              icon: <Archive className="icon-sm" />,
            },
          ]}
        />
      ) : null}
    </>
  );
}
