import { Button } from "../../shared/ui/Button";
import { WorkspaceFeatureGate } from "../../features/settings/ui/WorkspaceFeatureGate";
import { t, useLocale } from "../../shared/i18n";
import {
  AppWindow,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  DashboardSquare,
  Inbox,
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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { basename } from "../../platform/tauri/fs";
import { ToolNavigationContext } from "./ToolNavigation";
import { looksLikeProject } from "../../features/projects/model/recents";
import type { HarnessId } from "../../features/sessions/model/session";
import { CwdPicker } from "../../features/projects/ui/CwdPicker";
import { useLockOverscroll } from "../../shared/hooks/useLockOverscroll";
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
import { IS_MAC } from "../../platform/tauri/platform";
import type { RecentProject } from "../../features/projects/model/recents";
import { ExplorerMenu, type ExplorerMenuItem } from "../../features/files/ui/ExplorerMenu";
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

export function tabCopy(tab: Tab): {
  headline: string;
  meta: string;
  tooltip: string;
} {
  const project = tab.project.trim() || "~";
  const conversation = tab.title.trim();
  const file = tab.files[0] ?? "";
  const sessions = sessionMeta(tab);
  const untitled = t("New session");

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

/** Which tab-strip edges still have overflow to scroll toward. */
export function tabStripOverflow(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): { left: boolean; right: boolean } {
  const maxScroll = scrollWidth - clientWidth;
  if (maxScroll <= 1) return { left: false, right: false };
  return {
    left: scrollLeft > 1,
    right: scrollLeft < maxScroll - 1,
  };
}

export function titleTabClosable(tab: Tab, tabCount: number): boolean {
  return tabCount > 1 || !tab.blank;
}

/** Busy tabs stay: their stream is handled by this window's listeners, and a
 * shell cannot change windows. */
/** Busy tabs may move too: the move is queued until their response finishes. */
export function titleTabCanMoveToNewWindow(tab: Tab): boolean {
  return !tab.hasTerminal && !tab.terminal && !tab.movingWindow;
}

export type TitleTabContextAction = "others" | "right" | "left";

/** Tab ids affected by a context-menu action relative to its clicked tab. */
export function titleTabContextCloseIds(
  tabs: readonly Tab[],
  targetId: string,
  action: TitleTabContextAction,
): string[] {
  const targetIndex = tabs.findIndex((tab) => tab.id === targetId);
  if (targetIndex < 0) return [];
  if (action === "left") {
    return tabs.slice(0, targetIndex).map((tab) => tab.id);
  }
  if (action === "right") {
    return tabs.slice(targetIndex + 1).map((tab) => tab.id);
  }
  return tabs.filter((tab) => tab.id !== targetId).map((tab) => tab.id);
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
              status === "done" ? "opacity-100" : opacity
            } ${i > 0 ? "-ml-0.5" : ""}`}
          >
            {status === "busy" ? (
              <TerminalSpinner className="inline-block w-3.5 select-none text-center text-[11px] leading-none text-accent" />
            ) : status === "done" ? (
              <CheckCircle className="size-3.5 shrink-0 text-success" strokeWidth={2} />
            ) : (
              <HarnessIcon harness={harness} className="size-3.5 shrink-0" />
            )}
          </span>
        );
      })}
      {extra > 0 ? (
        <span
          className={`pl-0.5 text-[10px] leading-none ${dimmed ? "text-content/50" : "text-content"}`}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  );
}

type SortableApi = ReturnType<typeof useAnimatedReorder>;

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
  useLocale();
  const { headline, meta, tooltip } = tabCopy(tab);
  const fileIcon = tab.files[0];
  const accessibleTooltip = [
    tooltip,
    ...(tab.previewSessionId || tab.previewFileId ? [t("Preview")] : []),
    ...((tab.doneHarnesses?.length ?? 0) > 0 ? ["Response complete"] : []),
  ].join(" · ");

  return (
    <div
      ref={(el) => {
        sortable.setItemRef(tab.id, el);
        itemRef?.(el);
      }}
      className="reorder-item tab-motion group @container relative flex h-full cursor-default touch-none items-center self-stretch min-w-0 w-full"
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
        variant="item"
        motion="none"
        type="button"
        title={accessibleTooltip}
        aria-label={accessibleTooltip}
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
          if (event.key === "Enter" && (tab.previewFileId || tab.previewSessionId)) {
            if (tab.previewFileId) onPinFile?.(tab.previewFileId);
            if (tab.previewSessionId) onKeepSession?.(tab.previewSessionId);
          }
        }}
        className={`relative min-w-0 flex-1 self-center ${closable ? "pe-[var(--ui-control-height-compact)]" : ""}`}
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
            className={`size-3.5 shrink-0 ${active ? "text-content" : "text-content/55"}`}
            strokeWidth={1.75}
          />
        ) : (
          <span className={!active ? "opacity-55" : undefined}>
            <FileTypeIcon name={fileIcon} isDir={false} size={14} />
          </span>
        )}
        {/* Keep two-line tabs compact while leaving room for descenders. */}
        <span className="flex min-w-0 flex-1 flex-col justify-center">
          <span className="flex min-w-0 items-center gap-1">
            <TabLabel
              className={`leading-tight ${tab.previewFileId || tab.previewSessionId ? "italic" : ""} ${
                meta
                  ? "text-[13px] @min-[11rem]:text-[10px] @min-[11rem]:font-medium"
                  : "text-[13px]"
              }`}
            >
              {headline}
            </TabLabel>
            {tab.pendingWindowMove || tab.movingWindow ? (
              <span
                className="shrink-0 text-accent"
                title={
                  tab.movingWindow
                    ? t("Opening new window…")
                    : t("Moves to a new window when the response finishes")
                }
                aria-label={
                  tab.movingWindow
                    ? t("Opening new window…")
                    : t("Moves to a new window when the response finishes")
                }
              >
                <AppWindow className="size-3" strokeWidth={1.75} />
              </span>
            ) : null}
            {tab.dirty ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-content/70"
                title={t("Unsaved changes")}
                aria-label={t("Unsaved changes")}
              />
            ) : null}
          </span>
          {meta ? (
            <TabLabel className="hidden text-[10px] leading-tight text-content/45 @min-[11rem]:block">
              {meta}
            </TabLabel>
          ) : null}
        </span>
      </Button>
      {closable ? (
        <Button
          iconOnly
          label={t("Close {p0}", { p0: headline })}
          variant="ghost"
          motion="none"
          type="button"
          title={t("Close Tab")}
          aria-label={t("Close {p0}", { p0: headline })}
          data-no-drag
          data-tauri-drag-region="false"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
          className="absolute end-0 inset-bs-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 group-has-[button:focus-visible]:opacity-100"
        >
          <X className="size-3" strokeWidth={1.75} />
        </Button>
      ) : null}
    </div>
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
      title={label}
      aria-label={label}
      data-tauri-drag-region="false"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className={`absolute top-1/2 z-40 -translate-y-1/2 ${side === "left" ? "left-1" : "right-1"}`}
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
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
      title={label}
      aria-label={label}
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

export function DevModeLabel() {
  useLocale();
  if (!import.meta.env.DEV) return null;
  return (
    <span
      title={t("Development build")}
      className="mr-1 min-w-0 truncate rounded-md bg-skill/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-skill"
    >
      {t("Development")}
    </span>
  );
}

/** Flex spacer that keeps the Development badge next to the visit arrows. */
export function DevModeSlot({ fill = true }: { fill?: boolean }) {
  useLocale();
  return (
    <div className={`flex min-w-0 items-center justify-end ${fill ? "flex-1" : "shrink-0"}`}>
      <DevModeLabel />
    </div>
  );
}

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
  useLocale();
  return (
    <div className="flex shrink-0 items-center">
      <IconButton label={t("Back")} command="Tab: Back" disabled={!canGoBack} onClick={onGoBack}>
        <ChevronLeft className="size-3.5" strokeWidth={1.75} />
      </IconButton>
      <IconButton
        label={t("Forward")}
        command="Tab: Forward"
        disabled={!canGoForward}
        onClick={onGoForward}
      >
        <ChevronRight className="size-3.5" strokeWidth={1.75} />
      </IconButton>
      {onTogglePanel ? (
        <IconButton
          label={t(panelLabel)}
          command="App: Toggle Sidebar"
          active={panelActive}
          onClick={onTogglePanel}
        >
          <PanelLeft className="size-3.5" strokeWidth={1.75} />
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
  useLocale();
  const navigation = useContext(ToolNavigationContext)?.history;
  if (navigation) return (
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
          <ChevronLeft className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      ) : null}
      {onToggleSidebar ? (
        <IconButton
          label={t("Toggle Sidebar")}
          command="App: Toggle Sidebar"
          onClick={onToggleSidebar}
        >
          <PanelLeft className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      ) : null}
    </div>
  );
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
  useLocale();
  const [layoutMenu, setLayoutMenu] = useState<{ x: number; y: number } | null>(null);
  const splitRightShortcut = useKeybindingShortcut("Pane: Split Right");
  const splitDownShortcut = useKeybindingShortcut("Pane: Split Down");
  const maximizeShortcut = useKeybindingShortcut("Pane: Toggle Maximized");
  const closeShortcut = useKeybindingShortcut("Pane: Close");
  const layoutAnchorRef = useRef<HTMLDivElement | null>(null);
  const layoutMenuItems = useMemo(
    () =>
      layout
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
        : [],
    [layout, splitRightShortcut, splitDownShortcut, maximizeShortcut],
  );
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
  const { displayed, setTabNode, finishMotion } = useTabCloseMotion(tabs);
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
              nativeTabDrag.current ??= beginWindowTabDrag(
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
                  ? "Move after response finishes"
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
              overStrip ? "Release to reorder tabs" : undefined,
            );
            if (!onPlaceOnPane) {
              setExternalPaneDrop(null);
              return !overStrip;
            }
            if (!pulledBelowTabs(event)) {
              setExternalPaneDrop(null);
              setDropFeedback("move", event, "Release to reorder tabs");
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
                  ? `Split ${over.edge} with a new session`
                  : over.edge === "center"
                    ? "Add as pane tab"
                    : `Place ${over.edge}`,
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
  }, [activeId, tabs, onPlaceOnPane, onMoveToNewWindow, popOutTab]);
  const sortable = useAnimatedReorder(tabIds, onReorder, "x", externalTabDrop);
  const paneToTabDrop = useExternalTitleTabDrop();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const setTabStripRef = useCallback(
    (el: HTMLDivElement | null) => {
      tabStripRef.current = el;
      lockOverscroll(el);
    },
    [lockOverscroll],
  );
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false });
  const [tabMenu, setTabMenu] = useState<{
    tabId: string;
    x: number;
    y: number;
  } | null>(null);
  const syncTabOverflow = useCallback(() => {
    const el = tabStripRef.current;
    const next = el
      ? tabStripOverflow(el.scrollLeft, el.clientWidth, el.scrollWidth)
      : { left: false, right: false };
    setTabOverflow((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);
  const scrollTabsBy = useCallback((direction: -1 | 1) => {
    const el = tabStripRef.current;
    if (!el) return;
    const amount = Math.max(el.clientWidth * 0.6, 112);
    el.scrollBy({ left: direction * amount, behavior: "smooth" });
  }, []);
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const canDrag = tabs.length > 1 || Boolean(onMoveToNewWindow);

  useEffect(() => {
    if (sortable.draggingId) return;
    activeTabRef.current?.scrollIntoView({
      inline: "nearest",
      block: "nearest",
    });
  }, [activeId, sortable.draggingId]);

  useLayoutEffect(() => {
    const el = tabStripRef.current;
    if (!el) return;
    syncTabOverflow();
    el.addEventListener("scroll", syncTabOverflow, { passive: true });
    const ro = new ResizeObserver(syncTabOverflow);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", syncTabOverflow);
      ro.disconnect();
    };
  }, [syncTabOverflow]);

  useLayoutEffect(() => {
    syncTabOverflow();
  }, [activeId, syncTabOverflow, tabs]);

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeId), [activeId, tabs]);
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
  const systemTitle = useMemo(() => {
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
  }, [activeTab, cwd, appName]);

  useEffect(() => {
    document.title = systemTitle;
    try {
      void getCurrentWindow().setTitle(systemTitle);
    } catch (error) {
      console.warn("Title bar operation failed", error);
    }
  }, [systemTitle]);

  const contextTab = tabMenu ? tabs.find((tab) => tab.id === tabMenu.tabId) : undefined;
  const contextCloseIds = contextTab
    ? {
        others: titleTabContextCloseIds(tabs, contextTab.id, "others"),
        right: titleTabContextCloseIds(tabs, contextTab.id, "right"),
        left: titleTabContextCloseIds(tabs, contextTab.id, "left"),
      }
    : null;
  const contextMenuItems: ExplorerMenuItem[] = contextTab
    ? [
        ...(contextTab.previewSessionId || contextTab.previewFileId
          ? [
              {
                kind: "item" as const,
                id: "keep-open",
                label: t("Keep open"),
              },
            ]
          : []),
        ...(detached && onReturnTabToMain
          ? [
              {
                kind: "item" as const,
                id: "return-main",
                label: t("Return to main window"),
                disabled: contextTab.hasTerminal || contextTab.dirty || contextTab.movingWindow,
              },
            ]
          : []),
        {
          kind: "item",
          id: "close",
          get label() {
            return t("Close Tab");
          },
          shortcut: closeShortcut ?? undefined,
          disabled: !titleTabClosable(contextTab, tabs.length),
        },
        ...(onMoveToNewWindow
          ? [
              contextTab.pendingWindowMove
                ? {
                    kind: "item" as const,
                    id: "cancel-new-window",
                    get label() {
                      return t("Cancel Move to New Window");
                    },
                    get description() {
                      return t("Waiting for the running response to finish");
                    },
                  }
                : {
                    kind: "item" as const,
                    id: "new-window",
                    get label() {
                      return t("Move to New Window");
                    },
                    disabled: !titleTabCanMoveToNewWindow(contextTab),
                    description: contextTab.movingWindow
                      ? "Opening new window…"
                      : contextTab.hasTerminal || contextTab.terminal
                        ? "Terminals cannot move between windows"
                        : contextTab.busyHarnesses.length > 0
                          ? "Moves once the running response finishes"
                          : undefined,
                  },
            ]
          : []),
        { kind: "sep" },
        {
          kind: "item",
          id: "others",
          get label() {
            return t("Close Other Tabs");
          },
          disabled: contextCloseIds?.others.length === 0,
        },
        {
          kind: "item",
          id: "right",
          get label() {
            return t("Close Tabs to the Right");
          },
          disabled: contextCloseIds?.right.length === 0,
        },
        {
          kind: "item",
          id: "left",
          get label() {
            return t("Close Tabs to the Left");
          },
          disabled: contextCloseIds?.left.length === 0,
        },
        ...(onCloseIdleTabs
          ? [
              {
                kind: "item" as const,
                id: "close-idle",
                get label() {
                  return t("Close Idle Tabs");
                },
                disabled: !idleTabCount,
              },
            ]
          : []),
        ...(contextTab.sessionCount > 0 && (onArchiveTab || onDeleteTab)
          ? [
              { kind: "sep" as const },
              ...(onArchiveTab
                ? [
                    {
                      kind: "item" as const,
                      id: "archive",
                      get label() {
                        return t("Archive");
                      },
                      description:
                        contextTab.sessionCount > 1
                          ? `All ${contextTab.sessionCount} conversations in this tab`
                          : undefined,
                    },
                  ]
                : []),
              ...(onDeleteTab
                ? [
                    {
                      kind: "item" as const,
                      id: "delete",
                      get label() {
                        return t("Delete");
                      },
                      description:
                        contextTab.sessionCount > 1
                          ? `Permanently delete all ${contextTab.sessionCount} conversations in this tab`
                          : undefined,
                      danger: true,
                    },
                  ]
                : []),
            ]
          : []),
      ]
    : [];

  const onPickTabMenu = (id: string) => {
    if (!contextTab || !contextCloseIds) return;
    setTabMenu(null);
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
              aria-label={t("Layout")}
              title={t("Split and arrange panes")}
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
              <SplitSquare className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </div>
        ) : null}
        {showTrailingActions ? (
          <div className="flex items-center gap-0.5 px-2">
            {projectless && railClosed && onOpenInbox ? (
              <WorkspaceFeatureGate id="inbox">
                <IconButton label={t("Inbox")} command="App: Open Inbox" onClick={onOpenInbox}>
                  <Inbox className="size-3.5" strokeWidth={1.75} />
                </IconButton>
              </WorkspaceFeatureGate>
            ) : null}
            {projectless && railClosed && onOpenNotes ? (
              <IconButton label={t("Notes")} command="App: Open Notes" onClick={onOpenNotes}>
                <StickyNote className="size-3.5" strokeWidth={1.75} />
              </IconButton>
            ) : null}
            {!sessionSidebarOpen && !projectless ? (
              <>
                <IconButton label={t("Go to File")} command="App: Go to File" onClick={onGoToFile}>
                  <Search className="size-3.5" strokeWidth={1.75} />
                </IconButton>
                <IconButton label={t("New session")} command="Tab: New" onClick={onNew}>
                  <Plus className="size-3.5" strokeWidth={1.75} />
                </IconButton>
              </>
            ) : null}
            {!projectRailOpen && !showCurrentProject && onOpenSettings ? (
              <IconButton label={t("Settings")} command="App: Settings" onClick={onOpenSettings}>
                <Settings className="size-3.5" strokeWidth={1.75} />
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
      className={`bycoda-titlebar flex h-10 shrink-0 select-none items-stretch border-b border-stroke${
        compactRail ? " body-glass" : ""
      }`}
      data-tauri-drag-region="deep"
    >
      {compactRail ? (
        <div
          data-compact-title-nav
          className={`flex shrink-0 items-center ${IS_MAC ? "ps-[70px]" : "ps-1.5"}`}
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
          {IS_MAC ? <div className="w-[78px] shrink-0" /> : null}
          <div className="flex shrink-0 items-center px-1.5">
            <IconButton
              label={t("Toggle Sidebar")}
              command="App: Toggle Sidebar"
              onClick={onToggleSidebar}
            >
              <PanelLeft className="size-3.5" strokeWidth={1.75} />
            </IconButton>
          </div>
        </>
      ) : null}
      {!sessionSidebarOpen && !projectless && onToggleSessionSidebar ? (
        <div className="flex shrink-0 items-center px-1.5">
          {IS_MAC && railClosed && !compactRail ? <div className="w-[70px] shrink-0" /> : null}
          <IconButton
            label={t("Toggle Session Sidebar")}
            command="App: Toggle Session Sidebar"
            onClick={onToggleSessionSidebar}
          >
            <DashboardSquare className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        </div>
      ) : null}
      {showProjectButton && onSelectProject ? (
        <CwdPicker
          cwd={cwd}
          recents={recents}
          placement="below"
          onCwdChange={onSelectProject}
          onNewTerminal={onNewTerminal}
          buttonClassName="flex h-full min-w-0 max-w-64 shrink items-center gap-2 px-6 text-left text-sm font-medium leading-tight"
        >
          <span className="min-w-0 truncate text-content/50">{t("No project")}</span>
        </CwdPicker>
      ) : null}

      <div
        className={`flex min-w-0 flex-1 items-stretch${
          showProjectButton ? " border-l border-stroke" : ""
        }`}
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
          <div
            ref={setTabStripRef}
            data-title-tab-strip
            className="scrollbar-none flex h-full min-w-0 cursor-default items-center gap-0.5 overflow-x-auto overflow-y-hidden overscroll-none pl-1.5 pr-2.5"
          >
            {displayed.map((entry) => {
              const tab = entry.item;
              const shell = (
                <div
                  ref={(el) => {
                    if (!entry.closing) setTabNode(tab.id, el);
                  }}
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
                      className={`pointer-events-none absolute inset-y-1 z-50 w-0.5 rounded-full ${paneToTabDrop.invalid ? "bg-danger" : "bg-accent shadow-[0_0_8px_var(--color-accent)]"} ${
                        paneToTabDrop.position === "before" ? "left-0" : "right-0"
                      }`}
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
                    itemRef={
                      !entry.closing && tab.id === activeId
                        ? (el) => {
                            activeTabRef.current = el;
                          }
                        : undefined
                    }
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
          </div>
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
            title={t(
              "Return all sessions to the main window; running responses finish before moving",
            )}
          >
            <AppWindow className="size-4" aria-hidden />
          </Button>
        ) : null}
        {trailingControls}
      </div>
      {layoutMenu && layout ? (
        <ExplorerMenu
          x={layoutMenu.x}
          y={layoutMenu.y}
          items={layoutMenuItems}
          ariaLabel="Layout"
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
          ariaLabel={`Tab actions for ${tabCopy(contextTab).headline}`}
          onPick={onPickTabMenu}
          onClose={() => setTabMenu(null)}
        />
      ) : null}
    </header>
  );
}

export const TitleBar = memo(TitleBarComponent);
