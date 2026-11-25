import { Text } from "../../../shared/ui/Text";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { TabList, Tab, Tabs } from "../../../shared/ui/Tabs";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { Sash, type SashEndInfo } from "../../../shared/ui/Sash";
import { t, useT } from "../../../shared/i18n/technical";
import {
  ChevronDown,
  PanelBottom,
  PanelBottomClose,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  PanelTop,
  PanelTopClose,
  Plus,
  SplitSquare,
  Terminal,
  X,
} from "../../../shared/ui/icons";
import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useStableHandlers } from "../../../shared/hooks/useStableHandlers";
import { useAnimatedReorder } from "../../../shared/hooks/useAnimatedReorder";
import { ExplorerMenu } from "../../files/ui/ExplorerMenu";
import "./terminal.css";
import {
  clampDockSize,
  dockTerminalGroup,
  defaultDockSize,
  isVerticalDock,
  type DockSide,
  type ProjectTerminalDock,
} from "../../projects/model/projectTerminal";
import { MOD } from "../../../platform/tauri/platform";
import { terminalTabLabel, type TerminalMetaPatch } from "../model/terminalTab";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import {
  effectiveProfileId,
  useTerminalProfile,
  useTerminalProfiles,
} from "../model/terminalProfiles";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { RemoteCodeTerminalPane } from "./CodeTerminalDialog";

const TerminalView = lazySurface(async () => {
  const module = await import("./TerminalView");
  return { default: module.TerminalView };
});

type Props = {
  dock: ProjectTerminalDock;
  /** Hidden project docks retain shells but cannot own menus or menu actions. */
  visible?: boolean;
  focused: boolean;
  onFocus: () => void;
  onHide: () => void;
  onSideChange: (side: DockSide) => void;
  onSizePaint: (size: number) => void;
  onSizeCommit: (size: number) => void;
  onAddTerminal?: () => void;
  /** A terminal in another shell, from the profile menu beside New Terminal. */
  onAddTerminalWithProfile?: (profile: string) => void;
  onSplitTerminal?: (fileId: string) => void;
  /** Opens the setting that picks the shell new terminals start in. */
  onSelectDefaultProfile?: () => void;
  onSelectTerminal: (fileId: string) => void;
  onCloseTerminal: (fileId: string) => void;
  /** Closes every terminal except `keepId`; without it, all of them and the panel. */
  onCloseTerminals: (keepId?: string) => void;
  onReorderTerminals: (ids: string[]) => void;
  onTerminalMetaChange?: (fileId: string, patch: TerminalMetaPatch) => void;
};

const SIDE_ITEMS: { id: DockSide; label: string }[] = [
  {
    id: "bottom",
    get label() {
      return t("Dock Bottom");
    },
  },
  {
    id: "top",
    get label() {
      return t("Dock Top");
    },
  },
  {
    id: "left",
    get label() {
      return t("Dock Left");
    },
  },
  {
    id: "right",
    get label() {
      return t("Dock Right");
    },
  },
];

function sideIcon(side: DockSide) {
  if (side === "top") return <PanelTop className="icon-sm" />;
  if (side === "left") return <PanelLeft className="icon-sm" />;
  if (side === "right") return <PanelRight className="icon-sm" />;
  return <PanelBottom className="icon-sm" />;
}

/** Collapse-panel glyphs: distinct from X (close) and the profile menu's chevron. */
function hideIcon(side: DockSide) {
  if (side === "top") return <PanelTopClose className="icon-sm" strokeWidth={1.75} />;
  if (side === "left") return <PanelLeftClose className="icon-sm" strokeWidth={1.75} />;
  if (side === "right") return <PanelRightClose className="icon-sm" strokeWidth={1.75} />;
  return <PanelBottomClose className="icon-sm" strokeWidth={1.75} />;
}

function ProjectTerminalDockComponent({
  dock,
  visible = true,
  focused,
  onFocus,
  onHide,
  onSideChange,
  onSizePaint,
  onSizeCommit,
  onAddTerminal,
  onAddTerminalWithProfile,
  onSplitTerminal,
  onSelectDefaultProfile,
  onSelectTerminal,
  onCloseTerminal,
  onCloseTerminals,
  onReorderTerminals,
  onTerminalMetaChange,
}: Props) {
  const t = useT();
  const vertical = isVerticalDock(dock.side);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sidebarResize = useDragResize({
    min: 80,
    max: () =>
      Math.min(480, Math.max(0, (bodyRef.current?.clientWidth ?? window.innerWidth) - 120)),
    defaultWidth: 200,
    initial: 200,
  });
  const { setPaneRef: attachSidebarPane } = sidebarResize;
  const [moveMenu, setMoveMenu] = useState<HTMLElement | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [profileMenu, setProfileMenu] = useState<HTMLElement | null>(null);
  const [terminalMenu, setTerminalMenu] = useState<{
    x: number;
    y: number;
    id: string;
  } | null>(null);
  const isVisible = useStableCallback(() => visible);
  if (!visible && (moveMenu || closeOpen || profileMenu || terminalMenu)) {
    setMoveMenu(null);
    setCloseOpen(false);
    setProfileMenu(null);
    setTerminalMenu(null);
  }
  // One reorder engine for every tab-like list: pointer drag, Alt+Up/Down, Escape/cancel cleanup
  // and screen-reader announcements. The context menu offers Move Up / Move Down.
  const sortable = useAnimatedReorder(
    dock.pane.files.map((file) => file.id),
    onReorderTerminals,
    "y",
    undefined,
    {
      label: (id) => {
        const file = dock.pane.files.find((entry) => entry.id === id);
        return file ? terminalTabLabel(file) : "";
      },
    },
  );
  const sideButton = useRef<HTMLDivElement>(null);
  const profileButton = useRef<HTMLDivElement>(null);
  const profiles = useTerminalProfiles();
  const chosenProfile = useTerminalProfile();
  const defaultProfile = effectiveProfileId(profiles, chosenProfile);
  const dragStart = useRef(dock.size);
  const pending = useRef(dock.size);
  const frame = useRef<number | null>(null);
  const visibleIds = dockTerminalGroup(dock, dock.pane.activeFileId);
  const canSplit = (id: string) => !!onSplitTerminal && !dock.remoteRuns?.[id];
  const splitTerminal = (id: string) => {
    onSplitTerminal?.(id);
  };

  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const viewport = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const paint = (next: number) => {
    pending.current = next;
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      onSizePaint(pending.current);
    });
  };

  const commit = () => {
    if (frame.current != null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    onSizeCommit(pending.current);
  };

  // The Sash owns pointer capture, the body cursor, Escape/blur cancel and the arrow keys; it
  // reports a signed delta, which the dock turns into a clamped size for its side.
  const startResize = useStableCallback(() => {
    dragStart.current = dock.size;
    pending.current = dock.size;
  });
  const resizeBy = (delta: number) => {
    const signed = dock.side === "bottom" || dock.side === "right" ? -delta : delta;
    paint(clampDockSize(dock.side, dragStart.current + signed, viewport()));
  };
  // A cancelled drag restores the start size through a commit: a paint alone would leave
  // the owner's grid in drag mode, so a later close kept an empty dock row.
  const endResize = (_delta: number, { cancelled }: SashEndInfo) => {
    if (cancelled) {
      pending.current = dragStart.current;
      onSizePaint(dragStart.current);
    }
    commit();
  };

  const sash =
    dock.side === "top"
      ? "absolute inset-x-0 -bottom-px"
      : dock.side === "bottom"
        ? "absolute inset-x-0 -top-px"
        : dock.side === "left"
          ? "absolute inset-y-0 -right-px"
          : "absolute inset-y-0 -left-px";

  return (
    <section
      data-project-terminal-dock=""
      {...surfaceAttributes(
        {
          frame: "pane",
          edge:
            dock.side === "top"
              ? "bottom"
              : dock.side === "bottom"
                ? "top"
                : dock.side === "left"
                  ? "right"
                  : "left",
        },
        "project-terminal-dock relative flex h-full min-h-0 min-w-0",
      )}
      onMouseDown={onFocus}
    >
      <Sash
        orientation={vertical ? "horizontal" : "vertical"}
        label={t("Resize terminal")}
        appearance="hidden"
        value={dock.size}
        className={`${sash} terminal-dock-sash`}
        onResizeStart={startResize}
        onResize={resizeBy}
        onResizeEnd={endResize}
        onReset={() => {
          pending.current = defaultDockSize(dock.side);
          commit();
        }}
      />
      <div className="terminal-body" ref={bodyRef}>
        <PaneHeader
          as="header"
          className="terminal-header"
          actions={
            <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
              <div className="flex items-center">
                {onAddTerminal ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    label={t("New Terminal ({p0}`)", { p0: MOD })}
                    onClick={() => {
                      onAddTerminal();
                    }}
                  >
                    <Plus className="icon-sm" strokeWidth={1.75} />
                  </Button>
                ) : null}
                {onAddTerminalWithProfile ? (
                  <div ref={profileButton} className="terminal-profile-trigger">
                    {/* ui-drift-ignore: hand-rolled-disclosure -- this chevron opens a popup menu, not an inline panel. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      label={t("Launch Profile…")}
                      aria-expanded={!!profileMenu}
                      aria-haspopup="menu"
                      onClick={() => {
                        setMoveMenu(null);
                        setProfileMenu(profileMenu ? null : profileButton.current);
                      }}
                    >
                      <ChevronDown className="icon-sm" strokeWidth={1.75} />
                    </Button>
                  </div>
                ) : null}
                {canSplit(dock.pane.activeFileId) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    label={t("Split")}
                    onClick={() => splitTerminal(dock.pane.activeFileId)}
                  >
                    <SplitSquare className="icon-sm" strokeWidth={1.75} />
                  </Button>
                ) : null}
              </div>
              <div ref={setToolbarTarget} />
              <div className="flex items-center">
                <div ref={sideButton}>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    label={t("Move Terminal")}
                    aria-expanded={!!moveMenu}
                    aria-haspopup="menu"
                    onClick={() => {
                      setProfileMenu(null);
                      setMoveMenu(moveMenu ? null : sideButton.current);
                    }}
                  >
                    {sideIcon(dock.side)}
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  label={t("Hide Terminal ({p0}J)", { p0: MOD })}
                  onClick={onHide}
                >
                  {hideIcon(dock.side)}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  label={t("Close Terminals?")}
                  aria-haspopup="dialog"
                  disabled={dock.pane.files.length === 0}
                  onClick={() => setCloseOpen(true)}
                >
                  <X className="icon-sm" strokeWidth={1.75} />
                </Button>
              </div>
            </div>
          }
        />
        <aside
          ref={attachSidebarPane}
          className="terminal-sidebar"
          aria-label={t("Terminal controls")}
        >
          <Tabs
            value={dock.pane.activeFileId ?? ""}
            onValueChange={onSelectTerminal}
            orientation="vertical"
            variant="tab"
            panels="none"
          >
            <TabList className="terminal-list" label={t("Terminals")}>
              {dock.pane.files.map((file) => (
                <ActionHost
                  key={file.id}
                  ref={(el) => sortable.setItemRef(file.id, el)}
                  selected={file.id === dock.pane.activeFileId}
                  className="terminal-list-row reorder-item"
                  role="presentation"
                  onPointerDown={(event) => {
                    if (
                      event.button !== 0 ||
                      (event.target as HTMLElement).closest("[data-no-drag]")
                    )
                      return;
                    sortable.onItemPointerDown(file.id, event);
                  }}
                >
                  <Tab
                    value={file.id}
                    fullWidth
                    id={`terminal-tab-${file.id}`}
                    controls={`terminal-panel-${file.id}`}
                    className="terminal-list-item"
                    tooltip={terminalTabLabel(file)}
                    tooltipDetails={[file.cwd]}
                    onClick={(event) => {
                      if (sortable.consumeClick()) event.preventDefault();
                      else if (file.id === dock.pane.activeFileId) onSelectTerminal(file.id);
                    }}
                    onAuxClick={(event) => {
                      if (event.button === 1) onCloseTerminal(file.id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setTerminalMenu({
                        x: event.clientX,
                        y: event.clientY,
                        id: file.id,
                      });
                    }}
                    onKeyDown={(event) => sortable.onItemKeyDown(file.id, event)}
                  >
                    <Terminal className="icon-sm shrink-0" />
                    <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
                      {terminalTabLabel(file)}
                    </Text>
                  </Tab>
                  <div className="terminal-row-actions">
                    {canSplit(file.id) ? (
                      <InlineAction
                        label={`${t("Split")} — ${terminalTabLabel(file)}`}
                        tooltip={t("Split")}
                        motion="none"
                        type="button"
                        onClick={() => splitTerminal(file.id)}
                      >
                        <SplitSquare className="icon-sm" strokeWidth={1.75} />
                      </InlineAction>
                    ) : null}
                    <InlineAction
                      label={`${t("Close")} — ${terminalTabLabel(file)}`}
                      tooltip={t("Close")}
                      motion="none"
                      type="button"
                      onClick={() => onCloseTerminal(file.id)}
                    >
                      <X className="icon-sm" strokeWidth={1.75} />
                    </InlineAction>
                  </div>
                </ActionHost>
              ))}
            </TabList>
          </Tabs>
        </aside>
        <Sash
          {...sidebarResize.sashProps}
          label={`${t("Resize terminal")} — ${t("Terminals")}`}
          className="terminal-sidebar-sash"
        />
        <div
          className="terminal-canvas relative min-h-0 min-w-0 flex-1"
          style={
            {
              "--layout-terminal-columns": Math.max(1, visibleIds.length),
            } as CSSProperties
          }
        >
          {dock.pane.files.map((file) => {
            const selectedToolbarTarget =
              visible && file.id === dock.pane.activeFileId ? toolbarTarget : null;
            return (
              <div
                key={file.id}
                id={`terminal-panel-${file.id}`}
                role="tabpanel"
                aria-labelledby={`terminal-tab-${file.id}`}
                aria-hidden={!visibleIds.includes(file.id)}
                onMouseDown={() => onSelectTerminal(file.id)}
                {...surfaceAttributes(
                  visibleIds.indexOf(file.id) > 0 ? { frame: "pane", edge: "inline-start" } : {},
                  visibleIds.includes(file.id) ? "terminal-split-pane" : "hidden",
                )}
                style={
                  { "--layout-terminal-column": visibleIds.indexOf(file.id) + 1 } as CSSProperties
                }
              >
                {dock.remoteRuns?.[file.id] ? (
                  <RemoteCodeTerminalPane
                    {...dock.remoteRuns[file.id]}
                    dockToolbarTarget={selectedToolbarTarget}
                  />
                ) : (
                  <TerminalView
                    id={file.id}
                    cwd={file.cwd}
                    profile={file.shellProfile}
                    sshConnectionId={dock.sshShells?.[file.id]?.connectionId}
                    sshProject={dock.sshShells?.[file.id]?.project}
                    active={focused && file.id === dock.pane.activeFileId}
                    dockToolbarTarget={selectedToolbarTarget}
                    onMetaChange={(patch) => onTerminalMetaChange?.(file.id, patch)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {visible && terminalMenu ? (
        <ExplorerMenu
          x={terminalMenu.x}
          y={terminalMenu.y}
          ariaLabel={t("Terminal actions")}
          className="terminal-popup"
          items={[
            ...(canSplit(terminalMenu.id)
              ? [{ kind: "item" as const, id: "split", label: t("Split") }]
              : []),
            {
              kind: "item",
              id: "move-up",
              label: t("Move up"),
              disabled: dock.pane.files.findIndex((file) => file.id === terminalMenu.id) < 1,
            },
            {
              kind: "item",
              id: "move-down",
              label: t("Move down"),
              disabled:
                dock.pane.files.findIndex((file) => file.id === terminalMenu.id) >=
                dock.pane.files.length - 1,
            },
            { kind: "sep" },
            { kind: "item", id: "close", label: t("Close") },
            {
              kind: "item",
              id: "close-others",
              label: t("Close others"),
              disabled: dock.pane.files.length < 2,
            },
            { kind: "item", id: "close-all", label: t("Close All Terminals") },
          ]}
          onPick={(id) => {
            if (!isVisible()) return;
            if (id === "split") splitTerminal(terminalMenu.id);
            if (id === "move-up" || id === "move-down") {
              const moved = terminalMenu.id;
              sortable.moveBy(moved, id === "move-up" ? -1 : 1);
              // The menu held focus; hand it back to the tab that moved.
              requestAnimationFrame(() =>
                document.getElementById(`terminal-tab-${moved}`)?.focus(),
              );
            }
            if (id === "close") onCloseTerminal(terminalMenu.id);
            if (id === "close-others") onCloseTerminals(terminalMenu.id);
            if (id === "close-all") onCloseTerminals();
            setTerminalMenu(null);
          }}
          onClose={() => setTerminalMenu(null)}
        />
      ) : null}
      {visible && profileMenu ? (
        <ExplorerMenu
          anchor={profileMenu}
          side={dock.side === "top" ? "bottom" : "top"}
          align="end"
          className="terminal-popup"
          ariaLabel={t("Terminal profiles")}
          items={[
            ...(profiles?.profiles ?? []).map((profile) => ({
              kind: "item" as const,
              id: `profile:${profile.id}`,
              label: `${profile.name}${profile.id === defaultProfile ? ` (${t("Default")})` : ""}`,
              checked: profile.id === defaultProfile,
            })),
            ...(canSplit(dock.pane.activeFileId)
              ? [
                  { kind: "sep" as const },
                  { kind: "item" as const, id: "split", label: t("Split") },
                ]
              : []),
            ...(profiles?.error
              ? [
                  {
                    kind: "item" as const,
                    id: "profile-error",
                    label: profiles.error,
                    disabled: true,
                  },
                  { kind: "item" as const, id: "retry-profiles", label: t("Retry") },
                ]
              : []),
            ...(profiles && !profiles.error && profiles.profiles.length === 0
              ? [
                  {
                    kind: "item" as const,
                    id: "none",
                    label: t("No shells found"),
                    disabled: true,
                  },
                ]
              : []),
            ...(onSelectDefaultProfile
              ? [
                  { kind: "sep" as const },
                  {
                    kind: "item" as const,
                    id: "default",
                    label: t("Select Default Profile…"),
                  },
                ]
              : []),
          ]}
          onPick={(id) => {
            if (!isVisible()) return;
            setProfileMenu(null);
            if (id === "retry-profiles") profiles?.retry();
            else if (id === "default") onSelectDefaultProfile?.();
            else if (id === "split") splitTerminal(dock.pane.activeFileId);
            else if (id.startsWith("profile:")) {
              onAddTerminalWithProfile?.(id.slice("profile:".length));
            }
          }}
          onClose={() => setProfileMenu(null)}
        />
      ) : null}
      {visible && moveMenu ? (
        <ExplorerMenu
          anchor={moveMenu}
          side={dock.side === "top" ? "bottom" : "top"}
          align="end"
          className="terminal-popup"
          ariaLabel={t("Move Terminal")}
          items={SIDE_ITEMS.map((item) => ({
            kind: "item",
            id: item.id,
            label: item.label,
            checked: item.id === dock.side,
          }))}
          onPick={(id) => {
            if (!isVisible()) return;
            if (id === "top" || id === "bottom" || id === "left" || id === "right") {
              onSideChange(id);
            }
            setMoveMenu(null);
          }}
          onClose={() => setMoveMenu(null)}
        />
      ) : null}
      {visible && closeOpen ? (
        <Modal
          title={t("Close Terminals?")}
          size="sm"
          onClose={() => setCloseOpen(false)}
          initialFocus="[data-terminal-close-cancel]"
          footer={
            <Button data-terminal-close-cancel onClick={() => setCloseOpen(false)}>
              {t("Cancel")}
            </Button>
          }
        >
          <div className="grid gap-2">
            <Button
              disabled={!dock.pane.activeFileId}
              onClick={() => {
                setCloseOpen(false);
                if (isVisible() && dock.pane.activeFileId) onCloseTerminal(dock.pane.activeFileId);
              }}
            >
              {t("Close Active Terminal")}
            </Button>
            <Button
              disabled={!dock.pane.activeFileId || dock.pane.files.length < 2}
              onClick={() => {
                setCloseOpen(false);
                if (isVisible() && dock.pane.activeFileId) onCloseTerminals(dock.pane.activeFileId);
              }}
            >
              {t("Close others")}
            </Button>
            <Button
              tone="danger"
              disabled={dock.pane.files.length === 0}
              onClick={() => {
                setCloseOpen(false);
                if (isVisible()) onCloseTerminals();
              }}
            >
              {t("Close All Terminals")}
            </Button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

const MemoProjectTerminalDock = memo(ProjectTerminalDockComponent);

/** One dock per project stays mounted; stable handler proxies let a dock skip the
 * main area's renders unless its own dock state or focus changed. */
export function ProjectTerminalDock(props: Props) {
  return <MemoProjectTerminalDock {...useStableHandlers(props)} />;
}
