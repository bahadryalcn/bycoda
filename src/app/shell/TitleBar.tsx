import { surfaceAttributes } from "../../shared/ui/Surface";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { Text } from "../../shared/ui/Text";
import { Button } from "../../shared/ui/Button";
import { Badge } from "../../shared/ui/Badge";
import { StatusDot } from "../../shared/ui/StatusDot";
import { WindowChromeInset } from "../../shared/ui/PaneHeader";
import { Tooltip } from "../../shared/ui/Tooltip";
import { ActionHost, InlineAction } from "../../shared/ui/ActionHost";
import { WorkspaceFeatureGate } from "../../features/settings/ui/WorkspaceFeatureGate";
import { t, useLocale, useT } from "../../shared/i18n";
import {
  AppWindow,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  DashboardSquare,
  Inbox,
  Menu,
  PanelLeft,
  Plus,
  Search,
  Settings,
  SplitSquare,
  StickyNote,
  Terminal,
  X,
} from "../../shared/ui/icons";
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { basename } from "../../platform/tauri/fs";
import { ToolNavigationContext } from "./ToolNavigation";
import { TitleBarActionsSlot } from "./TitleBarActionsSlot";
import { looksLikeProject } from "../../features/projects/model/recents";
import type { HarnessId } from "../../features/sessions/model/session";
import { CwdPicker } from "../../features/projects/ui/CwdPicker";
import { useLockOverscroll } from "../../shared/hooks/useLockOverscroll";
import { useStableHandlers } from "../../shared/hooks/useStableHandlers";
import { setDropFeedback } from "../../shared/lib/drag";
import {
  useAnimatedReorder,
  type ReorderExternalDrop,
} from "../../shared/hooks/useAnimatedReorder";
import { useTabCloseMotion } from "../../features/workspace/hooks/useTabCloseMotion";
import { TabWidthMotion } from "./ClosingTab";
import { FileTypeIcon } from "../../features/files/ui/FileTypeIcon";
import { TabLabel } from "../../shared/ui/TabLabel";
import { HarnessIcon } from "../../features/sessions/ui/HarnessIcon";
import { loadAppName } from "../../shared/lib/appName";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TerminalSpinner } from "../../features/sessions/ui/TerminalSpinner";
import {
  isPointerOutsideWindow,
  pointerWindowMovePosition,
  type WindowMovePosition,
} from "../model/windowTransferPopout";
import { beginWindowTabDrag } from "../model/windowDragPreview";
import { WindowControls } from "./WindowControls";
import { APP_MENU_TOGGLE_EVENT } from "./MenuBar";
import { IS_MAC } from "../../platform/tauri/platform";
import type { RecentProject } from "../../features/projects/model/recents";
import { ExplorerMenu, type ExplorerMenuItem } from "../../features/files/ui/ExplorerMenu";
import { tabStripOverflow, useTabStripScroll } from "./useTabStripScroll";
import {
  buildTitleTabContextMenuItems,
  titleTabCanMoveToNewWindow,
  titleTabClosable,
  titleTabContextCloseIdSets,
  titleTabContextCloseIds,
  type TitleTabContextAction,
} from "./titleTabContextMenu";

export { tabStripOverflow, titleTabCanMoveToNewWindow, titleTabClosable, titleTabContextCloseIds };
export type { TitleTabContextAction };
import {
  paneDropFromPoint,
  setExternalPaneDrop,
  useExternalTitleTabDrop,
} from "../../features/workspace/model/paneDrop";
import type {
  PaneEdge,
  PaneTabDropPosition,
  SplitDir,
} from "../../features/workspace/model/layout";
import type { LayoutPreset } from "../../features/workspace/model/layoutPresets";
import { useKeybindingShortcut } from "../../features/settings/model/useKeybindingShortcut";
import {
  SPLIT_DOWN_ID,
  SPLIT_RIGHT_ID,
  buildLayoutMenuItems,
  layoutPresetFromMenuId,
} from "./layoutMenu";

/** The active tab's pane arrangement, driving the title bar Layout menu. */
export type TitleBarLayout = {
  current: LayoutPreset | null;
  canArrange: boolean;
  onArrange: (preset: LayoutPreset) => void;
  onSplit: (dir: SplitDir) => void;
  maximized?: boolean;
  onToggleMaximize?: () => void;
};

export type Tab = {
  id: string;
  /** Project folder name, e.g. `agent-terminal`. */
  project: string;
  /** Focused conversation title; empty for a fresh session. */
  title: string;
  /** Other conversation titles in this tab, focused session omitted. */
  more: string[];
  sessionCount: number;
  focusedPaneId?: string;
  paneIds?: string[];
  fileDragId?: string;
  harnesses: HarnessId[];
  /** Harnesses with an in-flight turn in this tab. */
  busyHarnesses: HarnessId[];
  /** Harnesses with a finished response that has not been focused yet. */
  doneHarnesses?: HarnessId[];
  /** Open file basenames, active files first. */
  files: string[];
  /** Split layout with more than one pane in this tab. */
  multiPane?: boolean;
  /** Focus is on a file/terminal pane rather than a conversation pane. */
  fileFocused?: boolean;
  /** The sole pane is a fresh conversation with no user turn or open file. */
  blank?: boolean;
  /** Explicit tab group; absent means ungrouped. */
  groupId?: string;
  dirty?: boolean;
  terminal?: boolean;
  /** A shell pane lives in this tab; ptys cannot change windows. */
  hasTerminal?: boolean;
  /** Queued to move to a new window once its running response finishes. */
  pendingWindowMove?: boolean;
  movingWindow?: boolean;
  /** File id when the whole tab is one preview file; double-click pins it. */
  previewFileId?: string;
  previewSessionId?: string;
};

type Props = {
  detached?: boolean;
  onReturnToMain?: () => void;
  onReturnTabToMain?: (tabId: string) => void;
  tabs: Tab[];
  activeId: string;
  cwd: string;
  projectRailOpen?: boolean;
  sessionSidebarOpen?: boolean;
  compactRail?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onToggleSidebar: () => void;
  onToggleSessionSidebar?: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onNewTerminal?: () => void;
  onOpenSettings?: () => void;
  onOpenInbox?: () => void;
  onOpenNotes?: () => void;
  onClose: (id: string) => void;
  onCloseMany: (ids: string[], fallbackId: string) => void;
  /** Closes every tab whose sessions are all idle; `idleTabCount` drives the disabled state. */
  onCloseIdleTabs?: () => void;
  idleTabCount?: number;
  onArchiveTab?: (id: string) => void;
  onDeleteTab?: (id: string) => void;
  onReorder: (ids: string[], movedId?: string) => void;
  onPlaceOnPane?: (
    tabId: string,
    targetId: string,
    edge: PaneEdge,
    tabPosition?: PaneTabDropPosition,
  ) => void;
  /** Pops the tab into its own window; `position` is the screen drop point. */
  onMoveToNewWindow?: (
    tabId: string,
    opts?: {
      position?: WindowMovePosition;
    },
  ) => void;
  /** Drops a move that is waiting for a running response to finish. */
  onCancelMoveToNewWindow?: (tabId: string) => void;
  onGoToFile?: () => void;
  onPinFile?: (fileId: string) => void;
  onKeepSession?: (sessionId: string) => void;
  recents?: RecentProject[];
  onSelectProject?: (path: string) => void;
  layout?: TitleBarLayout;
};

function sessionMeta(tab: Tab): string {
  if (tab.more.length === 1) return tab.more[0];
  if (tab.sessionCount > 1) return `${tab.sessionCount} sessions`;
  return "";
}

export function tabCopy(tab: Tab) {
  return buildTabCopy(tab, t("New session"));
}

// Takes the translated placeholder so components can pass the `useT()` text instead of the
// module `t`, which React Compiler cannot see change.
export function buildTabCopy(
  tab: Tab,
  untitled: string,
): {
  headline: string;
  meta: string;
  tooltip: string;
} {
  const project = tab.project.trim() || "~";
  const conversation = tab.title.trim();
  const file = tab.files[0] ?? "";
  const sessions = sessionMeta(tab);

  let headline: string;
  const metaParts: string[] = [];

  if (tab.multiPane) {
    if (conversation) {
      headline = conversation;
      if (file) metaParts.push(file);
      else if (sessions) metaParts.push(sessions);
    } else if (file) {
      headline = file;
      if (sessions) metaParts.push(sessions);
    } else {
      headline = untitled;
      if (sessions) metaParts.push(sessions);
    }
  } else {
    headline = conversation || file || untitled;
    if (sessions) metaParts.push(sessions);
  }

  const meta = metaParts.join(" · ");

  const tooltipParts = [project];
  if (conversation) tooltipParts.push(conversation);
  tooltipParts.push(...tab.more);
  if (tab.files.length > 0) tooltipParts.push(tab.files.join(", "));
  if (tab.dirty) tooltipParts.push("Unsaved changes");

  return { headline, meta, tooltip: tooltipParts.join(" · ") };
}

function TabHarnesses({
  harnesses,
  busyHarnesses,
  doneHarnesses,
  dimmed,
}: {
  harnesses: HarnessId[];
  busyHarnesses: HarnessId[];
  doneHarnesses: HarnessId[];
  dimmed: boolean;
}) {
  useLocale();
  const shown = harnesses.slice(0, 3);
  const extra = harnesses.length - shown.length;
  const opacity = dimmed ? "opacity-55" : "opacity-100";
  const busy = new Set(busyHarnesses);
  const done = new Set(doneHarnesses);

  return (
    <span className="flex shrink-0 items-center">
      {shown.map((harness, i) => {
        const status = busy.has(harness) ? "busy" : done.has(harness) ? "done" : "idle";
        return (
          <span
            key={harness}
            data-harness-status={status}
            className={`grid size-3.5 shrink-0 place-items-center ${
              status !== "idle" ? "opacity-100" : opacity
            } ${i > 0 ? "-ml-0.5" : ""}`}
          >
            {status === "busy" ? (
              <TerminalSpinner />
            ) : status === "done" ? (
              <CheckCircle className="icon-sm shrink-0" tone="success" strokeWidth={2} />
            ) : (
              <HarnessIcon harness={harness} className="size-3.5 shrink-0" />
            )}
          </span>
        );
      })}
      {extra > 0 ? (
        <Badge variant="count" size="xs" className="ms-0.5">
          +{extra}
        </Badge>
      ) : null}
    </span>
  );
}

type SortableApi = ReturnType<typeof useAnimatedReorder>;

const TAB_MOVE_LEFT_ID = "move-left";
const TAB_MOVE_RIGHT_ID = "move-right";

/**
 * The menu alternative to dragging a tab: Move Left / Move Right, disabled at the strip ends.
 * They sit above the first separator so closing actions stay grouped below.
 */
function withTabMoveItems(
  items: ExplorerMenuItem[],
  index: number,
  count: number,
  t: ReturnType<typeof useT>,
): ExplorerMenuItem[] {
  if (index < 0 || count < 2) return items;
  const moveItems: ExplorerMenuItem[] = [
    {
      kind: "item",
      id: TAB_MOVE_LEFT_ID,
      get label() {
        return t("Move Left");
      },
      disabled: index === 0,
    },
    {
      kind: "item",
      id: TAB_MOVE_RIGHT_ID,
      get label() {
        return t("Move Right");
      },
      disabled: index === count - 1,
    },
  ];
  const firstSeparator = items.findIndex((item) => item.kind === "sep");
  const at = firstSeparator < 0 ? items.length : firstSeparator;
  return [...items.slice(0, at), ...moveItems, ...items.slice(at)];
}

function TitleTabItem({
  tab,
  active,
  closable,
  canDrag,
  sortable,
  onSelect,
  onClose,
  onPinFile,
  onKeepSession,
  onContextMenu,
  itemRef,
}: {
  tab: Tab;
  active: boolean;
  closable: boolean;
  canDrag: boolean;
  sortable: SortableApi;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onPinFile?: (fileId: string) => void;
  onKeepSession?: (sessionId: string) => void;
  onContextMenu: (id: string, event: ReactMouseEvent<HTMLDivElement>) => void;
  itemRef?: (el: HTMLDivElement | null) => void;
}) {
  const t = useT();
  const { headline, meta, tooltip } = buildTabCopy(tab, t("New session"));
  const fileIcon = tab.files[0];
  const accessibleTooltip = [
    tooltip,
    ...(tab.previewSessionId || tab.previewFileId ? [t("Preview")] : []),
    ...((tab.doneHarnesses?.length ?? 0) > 0 ? ["Response complete"] : []),
  ].join(" · ");

  const setItemRef = sortable.setItemRef;
  const setNode = (el: HTMLDivElement | null) => {
    setItemRef(tab.id, el);
    itemRef?.(el);
  };

  return (
    <ActionHost
      controlHeight="compact"
      selected={active}
      ref={setNode}
      className="reorder-item tab-motion group @container relative flex w-full min-w-0 cursor-default touch-none items-center self-center"
      data-tauri-drag-region="false"
      data-tab-draggable={canDrag || undefined}
      onDragStart={(event) => event.preventDefault()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(tab.id, event);
      }}
      onMouseDownCapture={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button !== 1 || !closable) return;
        event.preventDefault();
        event.stopPropagation();
        onClose(tab.id);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
          return;
        }
        if (canDrag) sortable.onItemPointerDown(tab.id, event);
      }}
    >
      <Button
        selected={active}
        variant="tab"
        align="start"
        motion="none"
        type="button"
        tooltip={accessibleTooltip}
        aria-label={accessibleTooltip}
        aria-current={active ? "page" : undefined}
        data-tauri-drag-region="false"
        onClick={() => {
          if (sortable.consumeClick()) return;
          onSelect(tab.id);
        }}
        onDoubleClick={() => {
          if (tab.previewFileId) onPinFile?.(tab.previewFileId);
          if (tab.previewSessionId) onKeepSession?.(tab.previewSessionId);
        }}
        onKeyDown={(event) => {
          // Alt+Arrow moves the tab without dragging; the menu offers the same move.
          if (canDrag && sortable.onItemKeyDown(tab.id, event)) return;
          if (event.key === "Enter" && (tab.previewFileId || tab.previewSessionId)) {
            if (tab.previewFileId) onPinFile?.(tab.previewFileId);
            if (tab.previewSessionId) onKeepSession?.(tab.previewSessionId);
          }
        }}
        reserveEndAction={closable ? "control" : undefined}
        className="relative min-w-0 flex-1 self-center"
      >
        {tab.harnesses.length > 0 ? (
          <TabHarnesses
            harnesses={tab.harnesses}
            busyHarnesses={tab.busyHarnesses}
            doneHarnesses={tab.doneHarnesses ?? []}
            dimmed={!active}
          />
        ) : tab.terminal || !fileIcon ? (
          <Terminal
            className="icon-sm shrink-0"
            tone={active ? "primary" : "secondary"}
            strokeWidth={1.75}
          />
        ) : (
          <span className={!active ? "opacity-55" : undefined}>
            <FileTypeIcon name={fileIcon} isDir={false} size="sm" />
          </span>
        )}
        {/* One 28px row: the headline leads, secondary meta follows when there is room. */}
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="flex min-w-0 flex-1 items-center gap-1">
            <TabLabel
              size="secondary"
              leading="tight"
              className={tab.previewFileId || tab.previewSessionId ? "italic" : undefined}
            >
              {headline}
            </TabLabel>
            {tab.pendingWindowMove || tab.movingWindow ? (
              <Tooltip
                label={
                  tab.movingWindow
                    ? t("Opening new window…")
                    : t("Moves to a new window when the response finishes")
                }
              >
                <Text
                  size="inherit"
                  tone="accent"
                  className="shrink-0"
                  role="img"
                  aria-label={
                    tab.movingWindow
                      ? t("Opening new window…")
                      : t("Moves to a new window when the response finishes")
                  }
                >
                  <AppWindow className="icon-xs" strokeWidth={1.75} />
                </Text>
              </Tooltip>
            ) : null}
            {tab.dirty ? (
              <Tooltip label={t("Unsaved changes")}>
                <StatusDot tone="neutral" label={t("Unsaved changes")} />
              </Tooltip>
            ) : null}
          </span>
          {meta ? (
            <TabLabel
              size="caption"
              tone="secondary"
              leading="tight"
              className="hidden max-w-[45%] shrink-0 @min-[11rem]:block"
            >
              {meta}
            </TabLabel>
          ) : null}
        </span>
      </Button>
      {closable ? (
        <InlineAction
          label={t("Close {p0}", { p0: headline })}
          motion="none"
          type="button"
          tooltip={t("Close Tab")}
          aria-label={t("Close {p0}", { p0: headline })}
          data-no-drag
          data-tauri-drag-region="false"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
          onAuxClick={(event) => {
            // InlineAction keeps the host from seeing the click, so a middle click on the X closes here.
            if (event.button !== 1) return;
            event.preventDefault();
            onClose(tab.id);
          }}
          className="absolute end-0 inset-bs-1/2 -translate-y-1/2"
        >
          <X className="icon-xs" strokeWidth={1.75} />
        </InlineAction>
      ) : null}
    </ActionHost>
  );
}

function TabStripChevron({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  useLocale();
  const label = side === "left" ? "Scroll tabs left" : "Scroll tabs right";
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <Button
      iconOnly
      label={label}
      variant="ghost"
      motion="none"
      type="button"
      data-tauri-drag-region="false"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className={`absolute top-1/2 z-1 -translate-y-1/2 ${side === "left" ? "left-1" : "right-1"}`}
    >
      <Icon className="icon-sm" strokeWidth={1.75} />
    </Button>
  );
}

export function IconButton({
  label,
  command,
  active,
  accent,
  disabled,
  onClick,
  onOpenContextMenu,
  children,
}: {
  label: string;
  command?: string;
  active?: boolean;
  accent?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onOpenContextMenu?: (x: number, y: number) => void;
  children: ReactNode;
}) {
  useLocale();
  const shortcut = useKeybindingShortcut(command ?? "");
  return (
    <Button
      iconOnly
      label={label}
      shortcut={shortcut}
      variant="ghost"
      motion="none"
      type="button"
      aria-pressed={active || accent}
      aria-disabled={disabled}
      data-tauri-drag-region="false"
      onClick={() => {
        if (disabled) return;
        onClick?.();
      }}
      onContextMenu={
        onOpenContextMenu
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (disabled) return;
              event.currentTarget.focus();
              onOpenContextMenu(event.clientX, event.clientY);
            }
          : undefined
      }
      onKeyDown={
        onOpenContextMenu
          ? (event) => {
              if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
              event.preventDefault();
              event.stopPropagation();
              if (disabled) return;
              event.currentTarget.focus();
              const rect = event.currentTarget.getBoundingClientRect();
              onOpenContextMenu(rect.left, rect.bottom);
            }
          : undefined
      }
    >
      {children}
    </Button>
  );
}

/**
 * Compact entry to the application menus (File, View, Terminal) on platforms
 * without a native menu bar. It toggles the same menu bar the Alt key opens.
 */
function AppMenuButton() {
  const t = useT();
  return (
    <div className="flex shrink-0 items-center ps-1.5" data-app-menu-entry>
      <Button
        iconOnly
        label={t("Application menu")}
        shortcut="Alt"
        variant="ghost"
        motion="none"
        type="button"
        aria-haspopup="menu"
        data-tauri-drag-region="false"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          window.dispatchEvent(
            new CustomEvent(APP_MENU_TOGGLE_EVENT, {
              detail: { x: rect.left, y: rect.bottom + 2 },
            }),
          );
        }}
      >
        <Menu className="icon-sm" strokeWidth={1.75} aria-hidden="true" />
      </Button>
    </div>
  );
}

const TITLEBAR_HEIGHT = "calc(var(--ui-control-height-compact) + 0.5rem)";
const TITLEBAR_HEIGHT_STYLE = { height: TITLEBAR_HEIGHT, minHeight: TITLEBAR_HEIGHT } as const;

export function TabVisitNav({
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  onTogglePanel,
  panelActive = false,
  panelLabel = "Toggle Projects",
}: {
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onTogglePanel?: () => void;
  panelActive?: boolean;
  panelLabel?: string;
}) {
  const t = useT();
  return (
    <div className="flex shrink-0 items-center">
      <IconButton label={t("Back")} command="Tab: Back" disabled={!canGoBack} onClick={onGoBack}>
        <ChevronLeft className="icon-sm" strokeWidth={1.75} />
      </IconButton>
      <IconButton
        label={t("Forward")}
        command="Tab: Forward"
        disabled={!canGoForward}
        onClick={onGoForward}
      >
        <ChevronRight className="icon-sm" strokeWidth={1.75} />
      </IconButton>
      {onTogglePanel ? (
        <IconButton
          label={t(panelLabel)}
          command="App: Toggle Sidebar"
          active={panelActive}
          onClick={onTogglePanel}
        >
          <PanelLeft className="icon-sm" strokeWidth={1.75} />
        </IconButton>
      ) : null}
    </div>
  );
}

/** Back + rail toggle for overlay surfaces when the project rail is closed. */
export function OverlayNav({
  onBack,
  onToggleSidebar,
}: {
  onBack?: () => void;
  onToggleSidebar?: () => void;
}) {
  const t = useT();
  const navigation = useContext(ToolNavigationContext)?.history;
  if (navigation)
    return (
      <TabVisitNav
        canGoBack={navigation.canBack}
        canGoForward={navigation.canForward}
        onGoBack={navigation.onBack}
        onGoForward={navigation.onForward}
        onTogglePanel={onToggleSidebar}
      />
    );
  if (!onBack && !onToggleSidebar) return null;
  return (
    <div className="flex shrink-0 items-center px-1.5">
      {onBack ? (
        <IconButton label={t("Back")} command="Tab: Back" onClick={onBack}>
          <ChevronLeft className="icon-sm" strokeWidth={1.75} />
        </IconButton>
      ) : null}
      {onToggleSidebar ? (
        <IconButton
          label={t("Toggle Sidebar")}
          command="App: Toggle Sidebar"
          onClick={onToggleSidebar}
        >
          <PanelLeft className="icon-sm" strokeWidth={1.75} />
        </IconButton>
      ) : null}
    </div>
  );
}

function windowTitle(activeTab: Tab | undefined, cwd: string, appName: string): string {
  const activeName = activeTab
    ? activeTab.files[0]
      ? basename(activeTab.files[0])
      : activeTab.project
    : "";
  const project = cwd ? basename(cwd) : "";
  if (activeName && project && activeName !== project) {
    return `${activeName} — ${project} — ${appName}`;
  }
  if (project) {
    return `${project} — ${appName}`;
  }
  return appName;
}

function TitleBarComponent({
  detached = false,
  onReturnToMain,
  onReturnTabToMain,
  tabs,
  activeId,
  cwd,
  projectRailOpen = true,
  sessionSidebarOpen = true,
  compactRail = false,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  onToggleSidebar,
  onToggleSessionSidebar,
  onSelect,
  onNew,
  onNewTerminal,
  onOpenSettings,
  onOpenInbox,
  onOpenNotes,
  onClose,
  onCloseMany,
  onCloseIdleTabs,
  idleTabCount,
  onArchiveTab,
  onDeleteTab,
  onReorder,
  onPlaceOnPane,
  onMoveToNewWindow,
  onCancelMoveToNewWindow,
  onGoToFile,
  onPinFile,
  onKeepSession,
  recents = [],
  onSelectProject,
  layout,
}: Props) {
  const t = useT();
  const [layoutMenu, setLayoutMenu] = useState<{ x: number; y: number } | null>(null);
  const splitRightShortcut = useKeybindingShortcut("Pane: Split Right");
  const splitDownShortcut = useKeybindingShortcut("Pane: Split Down");
  const maximizeShortcut = useKeybindingShortcut("Pane: Toggle Maximized");
  const closeShortcut = useKeybindingShortcut("Pane: Close");
  const layoutAnchorRef = useRef<HTMLDivElement | null>(null);
  const layoutMenuItems = layout
    ? [
        ...buildLayoutMenuItems({
          current: layout.current,
          canArrange: layout.canArrange,
          splitRightShortcut: splitRightShortcut ?? undefined,
          splitDownShortcut: splitDownShortcut ?? undefined,
        }),
        ...(layout.onToggleMaximize
          ? [
              { kind: "sep" as const },
              {
                kind: "item" as const,
                id: "toggle-maximize",
                label: t(layout.maximized ? "Restore panel layout" : "Maximize panel"),
                shortcut: maximizeShortcut ?? undefined,
              },
            ]
          : []),
      ]
    : [];
  const onPickLayoutMenu = (id: string) => {
    setLayoutMenu(null);
    if (!layout) return;
    if (id === SPLIT_RIGHT_ID) layout.onSplit("right");
    else if (id === SPLIT_DOWN_ID) layout.onSplit("down");
    else if (id === "toggle-maximize") layout.onToggleMaximize?.();
    else {
      const preset = layoutPresetFromMenuId(id);
      if (preset) layout.onArrange(preset);
    }
  };
  const tabIds = tabs.map((tab) => tab.id);
  const { displayed, tabRef, finishMotion } = useTabCloseMotion(tabs);
  const popOutTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((entry) => entry.id === tabId);
      return tab ? titleTabCanMoveToNewWindow(tab) : false;
    },
    [tabs],
  );
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const paneDropArmed = useRef(false);
  const nativeTabDrag = useRef<ReturnType<typeof beginWindowTabDrag> | undefined>(undefined);
  useEffect(() => () => nativeTabDrag.current?.finish(), []);
  const externalTabDrop = useMemo<ReorderExternalDrop<string> | undefined>(() => {
    // A sideways reorder may sag below the strip. Require a deliberate pull
    // before targeting panes, and disarm when the pointer returns to the tabs.
    const pulledBelowTabs = (event: PointerEvent) => {
      const strip = tabStripRef.current;
      if (!strip) return false;
      const bottom = strip.getBoundingClientRect().bottom;
      if (event.clientY <= bottom) paneDropArmed.current = false;
      else if (event.clientY >= bottom + 32) paneDropArmed.current = true;
      return paneDropArmed.current;
    };
    return onPlaceOnPane || onMoveToNewWindow
      ? {
          onMove: (tabId, event) => {
            if (onMoveToNewWindow && popOutTab(tabId)) {
              const source = tabs.find((tab) => tab.id === tabId);
              // Not `??=`: React Compiler cannot lower that operator.
              if (!nativeTabDrag.current)
                nativeTabDrag.current = beginWindowTabDrag(
                  source?.fileDragId ? `file:${source.fileDragId}` : tabId,
                  source?.paneIds,
                );
              nativeTabDrag.current.move(event);
            }
            if (
              onMoveToNewWindow &&
              popOutTab(tabId) &&
              isPointerOutsideWindow(
                event.clientX,
                event.clientY,
                window.innerWidth,
                window.innerHeight,
              )
            ) {
              setDropFeedback(
                "window",
                event,
                tabs.find((tab) => tab.id === tabId)?.busyHarnesses.length
                  ? t("Move after response finishes")
                  : undefined,
              );
              setExternalPaneDrop(null);
              return true;
            }
            const overStrip = document
              .elementFromPoint(event.clientX, event.clientY)
              ?.closest("[data-title-tab-strip]");
            setDropFeedback(
              overStrip ? "move" : "blocked",
              event,
              overStrip ? t("Release to reorder tabs") : undefined,
            );
            if (!onPlaceOnPane) {
              setExternalPaneDrop(null);
              return !overStrip;
            }
            if (!pulledBelowTabs(event)) {
              setExternalPaneDrop(null);
              setDropFeedback("move", event, t("Release to reorder tabs"));
              return false;
            }
            const over = paneDropFromPoint(event.clientX, event.clientY);
            if (
              over &&
              tabId === activeId &&
              tabs.find((tab) => tab.id === tabId)?.focusedPaneId === over.id &&
              over.edge === "center"
            ) {
              setExternalPaneDrop(null);
              return true;
            }
            setExternalPaneDrop({
              fromId: tabId,
              overId: over?.id ?? null,
              edge: over?.edge ?? "left",
              tabPosition: over?.tabPosition,
              invalid: over?.invalid,
            });
            if (over && !over.invalid)
              setDropFeedback(
                "move",
                event,
                tabId === activeId &&
                  tabs.find((tab) => tab.id === tabId)?.focusedPaneId === over.id
                  ? t("Split {p0} with a new session", { p0: t(over.edge) })
                  : over.edge === "center"
                    ? t("Add as pane tab")
                    : t("Place {p0}", { p0: t(over.edge) }),
              );
            return over != null || !overStrip;
          },
          onDrop: (tabId, event) => {
            if (
              onMoveToNewWindow &&
              popOutTab(tabId) &&
              isPointerOutsideWindow(
                event.clientX,
                event.clientY,
                window.innerWidth,
                window.innerHeight,
              )
            ) {
              onMoveToNewWindow(tabId, {
                position: pointerWindowMovePosition(event),
              });
              return true;
            }
            const overStrip = document
              .elementFromPoint(event.clientX, event.clientY)
              ?.closest("[data-title-tab-strip]");
            if (!onPlaceOnPane) return !overStrip;
            if (!pulledBelowTabs(event)) return false;
            const over = paneDropFromPoint(event.clientX, event.clientY);
            if (!over) return !overStrip;
            if (
              tabId === activeId &&
              tabs.find((tab) => tab.id === tabId)?.focusedPaneId === over.id &&
              over.edge === "center"
            )
              return true;
            if (!over.invalid) {
              if (over.tabPosition) onPlaceOnPane(tabId, over.id, over.edge, over.tabPosition);
              else onPlaceOnPane(tabId, over.id, over.edge);
            }
            return true;
          },
          onEnd: () => {
            paneDropArmed.current = false;
            nativeTabDrag.current?.finish();
            nativeTabDrag.current = undefined;
            setExternalPaneDrop(null);
          },
        }
      : undefined;
  }, [activeId, tabs, onPlaceOnPane, onMoveToNewWindow, popOutTab, t]);
  const sortable = useAnimatedReorder(tabIds, onReorder, "x", externalTabDrop, {
    label: (tabId) => {
      const tab = tabs.find((entry) => entry.id === tabId);
      return tab ? buildTabCopy(tab, t("New session")).headline : "";
    },
  });
  const paneToTabDrop = useExternalTitleTabDrop();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const setTabStripRef = (el: HTMLDivElement | null) => {
    tabStripRef.current = el;
    lockOverscroll(el);
  };
  const [tabMenu, setTabMenu] = useState<{
    tabId: string;
    x: number;
    y: number;
  } | null>(null);
  const { tabOverflow, scrollTabsBy, activeTabRef } = useTabStripScroll({
    tabStripRef,
    activeId,
    tabs,
    dragging: Boolean(sortable.draggingId),
  });
  const setActiveTabNode = (node: HTMLDivElement | null) => {
    activeTabRef.current = node;
  };
  const canDrag = tabs.length > 1 || Boolean(onMoveToNewWindow);

  const activeTab = tabs.find((t) => t.id === activeId);
  // The product name differs between the official, fork and dev builds.
  const [appName, setAppName] = useState<string>(PRODUCT_IDENTITY.displayName);
  useEffect(() => {
    void (async () => {
      try {
        setAppName(await loadAppName());
      } catch (error) {
        console.warn("Title bar operation failed", error);
      }
    })();
  }, []);
  const systemTitle = windowTitle(activeTab, cwd, appName);

  useEffect(() => {
    document.title = systemTitle;
    void Promise.resolve()
      .then(() => getCurrentWindow().setTitle(systemTitle))
      .catch((error: unknown) => console.warn("Title bar operation failed", error));
  }, [systemTitle]);

  const contextTab = tabMenu ? tabs.find((tab) => tab.id === tabMenu.tabId) : undefined;
  const contextCloseIds = contextTab ? titleTabContextCloseIdSets(tabs, contextTab.id) : null;
  const contextMenuItems: ExplorerMenuItem[] = contextTab
    ? withTabMoveItems(
        buildTitleTabContextMenuItems({
          contextTab,
          tabs,
          t,
          detached,
          closeShortcut,
          idleTabCount,
          hasReturnTabToMain: Boolean(onReturnTabToMain),
          hasMoveToNewWindow: Boolean(onMoveToNewWindow),
          hasCloseIdleTabs: Boolean(onCloseIdleTabs),
          hasArchiveTab: Boolean(onArchiveTab),
          hasDeleteTab: Boolean(onDeleteTab),
        }),
        tabs.findIndex((tab) => tab.id === contextTab.id),
        tabs.length,
        t,
      )
    : [];

  const onPickTabMenu = (id: string) => {
    if (!contextTab || !contextCloseIds) return;
    setTabMenu(null);
    if (id === TAB_MOVE_LEFT_ID || id === TAB_MOVE_RIGHT_ID) {
      sortable.moveBy(contextTab.id, id === TAB_MOVE_LEFT_ID ? -1 : 1);
      return;
    }
    if (id === "keep-open") {
      if (contextTab.previewSessionId) onKeepSession?.(contextTab.previewSessionId);
      if (contextTab.previewFileId) onPinFile?.(contextTab.previewFileId);
      return;
    }
    if (id === "close") {
      onClose(contextTab.id);
      return;
    }
    if (id === "new-window") {
      onMoveToNewWindow?.(contextTab.id);
      return;
    }
    if (id === "return-main") {
      onReturnTabToMain?.(contextTab.id);
      return;
    }
    if (id === "cancel-new-window") {
      onCancelMoveToNewWindow?.(contextTab.id);
      return;
    }
    if (id === "archive") {
      onArchiveTab?.(contextTab.id);
      return;
    }
    if (id === "delete") {
      onDeleteTab?.(contextTab.id);
      return;
    }
    if (id === "close-idle") {
      onCloseIdleTabs?.();
      return;
    }
    if (id === "others" || id === "right" || id === "left") {
      onCloseMany(contextCloseIds[id], contextTab.id);
    }
  };

  const railClosed = !projectRailOpen;
  const showCurrentProject = looksLikeProject(cwd);
  // Until a project is picked, the rail and the sidebar hide, so nothing
  // project-scoped is actionable and the window controls need room.
  const projectless = !showCurrentProject;
  // An open project is labeled in the sidebar, above Sessions / Explorer /
  // Changes. Without a project that sidebar is gone, so the picker stays here.
  const showProjectButton = railClosed && Boolean(onSelectProject) && !showCurrentProject;
  const showTrailingActions =
    (projectless && railClosed && Boolean(onOpenInbox || onOpenNotes || onOpenSettings)) ||
    (!sessionSidebarOpen && !projectless);
  const showLayoutControl = Boolean(layout);
  const trailingControls =
    showCurrentProject || showTrailingActions || showLayoutControl || !IS_MAC ? (
      <div className="flex h-full shrink-0 items-stretch">
        {showLayoutControl ? (
          <div ref={layoutAnchorRef} className="flex items-center pl-1 pr-1" data-layout-control>
            <Button
              iconOnly
              label={t("Layout")}
              variant="ghost"
              selected={layoutMenu != null}
              motion="none"
              type="button"
              tooltip={t("Split and arrange panes")}
              aria-label={t("Layout")}
              onClick={() => {
                if (layoutMenu) {
                  setLayoutMenu(null);
                  return;
                }
                const rect = layoutAnchorRef.current?.getBoundingClientRect();
                if (!rect) return;
                setLayoutMenu({
                  x: Math.max(8, rect.right - 228),
                  y: rect.bottom + 2,
                });
              }}
            >
              <SplitSquare className="icon-sm" strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </div>
        ) : null}
        {showTrailingActions ? (
          <div className="flex items-center gap-0.5 px-2">
            {projectless && railClosed && onOpenInbox ? (
              <WorkspaceFeatureGate id="inbox">
                <IconButton label={t("Inbox")} command="App: Open Inbox" onClick={onOpenInbox}>
                  <Inbox className="icon-sm" strokeWidth={1.75} />
                </IconButton>
              </WorkspaceFeatureGate>
            ) : null}
            {projectless && railClosed && onOpenNotes ? (
              <IconButton label={t("Notes")} command="App: Open Notes" onClick={onOpenNotes}>
                <StickyNote className="icon-sm" strokeWidth={1.75} />
              </IconButton>
            ) : null}
            {!sessionSidebarOpen && !projectless ? (
              <>
                <IconButton label={t("Go to File")} command="App: Go to File" onClick={onGoToFile}>
                  <Search className="icon-sm" strokeWidth={1.75} />
                </IconButton>
                <IconButton label={t("New session")} command="Tab: New" onClick={onNew}>
                  <Plus className="icon-sm" strokeWidth={1.75} />
                </IconButton>
              </>
            ) : null}
            {!projectRailOpen && !showCurrentProject && onOpenSettings ? (
              <IconButton label={t("Settings")} command="App: Settings" onClick={onOpenSettings}>
                <Settings className="icon-sm" strokeWidth={1.75} />
              </IconButton>
            ) : null}
          </div>
        ) : null}
        {!IS_MAC && !detached ? <WindowControls /> : null}
      </div>
    ) : null;

  // "deep" drags from anywhere in the subtree. The bare attribute only drags
  // on a direct hit, which left every label and spacer dead. Tauri still
  // exempts buttons, links and inputs on its own.
  return (
    <header
      {...surfaceAttributes(
        { frame: "pane", edge: "bottom" },
        `bycoda-titlebar flex h-9 shrink-0 select-none items-stretch${compactRail ? " body-glass" : ""}`,
      )}
      // The row is one compact control plus 4px above and below, so it grows with
      // the density and UI-scale setting instead of clipping its controls at 36px.
      style={TITLEBAR_HEIGHT_STYLE}
      data-tauri-drag-region="deep"
    >
      {!IS_MAC ? <AppMenuButton /> : null}
      {compactRail ? (
        <div
          data-compact-title-nav
          // Native traffic lights occupy 64px plus 6px clearance.
          style={
            IS_MAC
              ? ({ "--mac-traffic-lights-reserve": "calc(4rem + 0.375rem)" } as React.CSSProperties)
              : undefined
          }
          className={`flex shrink-0 items-center ${IS_MAC ? "ps-(--mac-traffic-lights-reserve)" : "ps-1.5"}`}
        >
          <TabVisitNav
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onGoBack={onGoBack}
            onGoForward={onGoForward}
          />
        </div>
      ) : null}
      {/* Both the rail and the sidebar step aside without a project, so the
          title bar takes over the traffic lights and the rail toggle. */}
      {projectless && railClosed && !compactRail ? (
        <>
          <WindowChromeInset />
          <div className="flex shrink-0 items-center px-1.5">
            <IconButton
              label={t("Toggle Sidebar")}
              command="App: Toggle Sidebar"
              onClick={onToggleSidebar}
            >
              <PanelLeft className="icon-sm" strokeWidth={1.75} />
            </IconButton>
          </div>
        </>
      ) : null}
      {!sessionSidebarOpen && !projectless && onToggleSessionSidebar ? (
        <>
          <WindowChromeInset active={railClosed && !compactRail} />
          <div className="flex shrink-0 items-center px-1.5">
            <IconButton
              label={t("Toggle Session Sidebar")}
              command="App: Toggle Session Sidebar"
              onClick={onToggleSessionSidebar}
            >
              <DashboardSquare className="icon-sm" strokeWidth={1.75} />
            </IconButton>
          </div>
        </>
      ) : null}
      {showProjectButton && onSelectProject ? (
        <CwdPicker
          cwd={cwd}
          recents={recents}
          placement="below"
          onCwdChange={onSelectProject}
          onNewTerminal={onNewTerminal}
          buttonClassName="flex h-full min-w-0 max-w-64 shrink items-center gap-2 px-6 text-left"
        >
          <Text
            size="body"
            tone="secondary"
            weight="medium"
            leading="tight"
            truncate
            className="min-w-0"
          >
            {t("No project")}
          </Text>
        </CwdPicker>
      ) : null}

      <div
        {...surfaceAttributes(
          {
            frame: showProjectButton ? "pane" : undefined,
            edge: showProjectButton ? "left" : undefined,
          },
          "flex min-w-0 flex-1 items-stretch",
        )}
      >
        <div
          className="relative h-full min-w-0 flex-1 overflow-hidden"
          onWheel={(event) => {
            const el = tabStripRef.current;
            if (!el || el.scrollWidth <= el.clientWidth) return;
            if (event.deltaX === 0 && event.deltaY !== 0) {
              el.scrollLeft += event.deltaY;
            }
          }}
        >
          {tabOverflow.left ? (
            <TabStripChevron side="left" onClick={() => scrollTabsBy(-1)} />
          ) : null}
          {tabOverflow.right ? (
            <TabStripChevron side="right" onClick={() => scrollTabsBy(1)} />
          ) : null}
          <ScrollArea
            axis="x"
            scrollbar="hidden"
            ref={setTabStripRef}
            data-title-tab-strip
            className="flex h-full min-w-0 cursor-default items-center gap-0.5 overscroll-none pl-1.5 pr-2.5"
          >
            {displayed.map((entry) => {
              const tab = entry.item;
              const shell = (
                <div
                  ref={entry.closing ? undefined : tabRef(tab.id)}
                  className={
                    entry.closing || entry.opening
                      ? "relative flex h-full w-full min-w-0 overflow-hidden items-center"
                      : "relative flex h-full w-56 min-w-40 shrink cursor-default items-center"
                  }
                  data-title-tab-id={entry.closing ? undefined : tab.id}
                  data-tab-slot-id={entry.closing ? undefined : tab.id}
                  data-tauri-drag-region="false"
                >
                  {!entry.closing && paneToTabDrop?.targetTabId === tab.id ? (
                    <span
                      data-pane-tab-drop-hint
                      {...surfaceAttributes(
                        {
                          radius: "pill",
                          tone: paneToTabDrop.invalid ? "danger" : "accent",
                          toneFill: "solid",
                        },
                        `pointer-events-none absolute inset-y-1 z-1 w-0.5 ${
                          paneToTabDrop.position === "before" ? "left-0" : "right-0"
                        }`,
                      )}
                    />
                  ) : null}
                  <TitleTabItem
                    tab={tab}
                    active={!entry.closing && tab.id === activeId}
                    closable={!entry.closing && titleTabClosable(tab, tabs.length)}
                    canDrag={!entry.closing && canDrag}
                    sortable={sortable}
                    onSelect={onSelect}
                    onClose={onClose}
                    onPinFile={onPinFile}
                    onKeepSession={onKeepSession}
                    onContextMenu={(tabId, event) =>
                      setTabMenu({
                        tabId,
                        x: event.clientX,
                        y: event.clientY,
                      })
                    }
                    itemRef={!entry.closing && tab.id === activeId ? setActiveTabNode : undefined}
                  />
                </div>
              );
              if (entry.closing || entry.opening) {
                return (
                  <TabWidthMotion
                    key={tab.id}
                    phase={entry.closing ? "closing" : "opening"}
                    width={entry.width}
                    onFinish={() => finishMotion(tab.id)}
                  >
                    {shell}
                  </TabWidthMotion>
                );
              }
              return (
                <div key={tab.id} className="contents">
                  {shell}
                </div>
              );
            })}
          </ScrollArea>
        </div>

        {detached && onReturnToMain ? (
          <Button
            iconOnly
            label={t("Return to main window")}
            variant="ghost"
            motion="none"
            type="button"
            onClick={onReturnToMain}
            className="return-to-main my-1 shrink-0"
            aria-label={t("Return to main window")}
            tooltip={t(
              "Return all sessions to the main window; running responses finish before moving",
            )}
          >
            <AppWindow className="icon-md" aria-hidden />
          </Button>
        ) : null}
        <TitleBarActionsSlot />
        {trailingControls}
      </div>
      {layoutMenu && layout ? (
        <ExplorerMenu
          x={layoutMenu.x}
          y={layoutMenu.y}
          items={layoutMenuItems}
          ariaLabel={t("Layout")}
          onPick={onPickLayoutMenu}
          onClose={() => setLayoutMenu(null)}
        />
      ) : null}
      {tabMenu && contextTab ? (
        <ExplorerMenu
          x={tabMenu.x}
          y={tabMenu.y}
          width={244}
          items={contextMenuItems}
          ariaLabel={`Tab actions for ${buildTabCopy(contextTab, t("New session")).headline}`}
          onPick={onPickTabMenu}
          onClose={() => setTabMenu(null)}
        />
      ) : null}
    </header>
  );
}

const MemoTitleBar = memo(TitleBarComponent);

/** The workspace recreates most handlers per render; stable proxies let the memo hold. */
export function TitleBar(props: Props) {
  return <MemoTitleBar {...useStableHandlers(props)} />;
}
