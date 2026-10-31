import { Button } from "../../../shared/ui/Button";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { t, useLocale } from "../../../shared/i18n/technical";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  MoreHorizontal,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Plus,
  SplitSquare,
  Terminal,
  X,
} from "../../../shared/ui/icons";
import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useStableHandlers } from "../../../shared/hooks/useStableHandlers";
import { useAnimatedReorder } from "../../../shared/hooks/useAnimatedReorder";
import { ExplorerMenu } from "../../files/ui/ExplorerMenu";
import "./terminal.css";
import { IconButton } from "../../../app/shell/TitleBar";
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

const TerminalView = lazySurface(async () => {
  const module = await import("./TerminalView");
  return { default: module.TerminalView };
});

type Props = {
  dock: ProjectTerminalDock;
  focused: boolean;
  onFocus: () => void;
  onHide: () => void;
  onSideChange: (side: DockSide) => void;
  onSizePaint: (size: number) => void;
  onSizeCommit: (size: number) => void;
  onAddTerminal: () => void;
  /** A terminal in another shell, from the profile menu beside New Terminal. */
  onAddTerminalWithProfile?: (profile: string) => void;
  onSplitTerminal?: (fileId: string) => void;
  /** Opens the setting that picks the shell new terminals start in. */
  onSelectDefaultProfile?: () => void;
  onSelectTerminal: (fileId: string) => void;
  onCloseTerminal: (fileId: string) => void;
  onCloseOtherTerminals: (fileId: string) => void;
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
  if (side === "top") return PanelTop;
  if (side === "left") return PanelLeft;
  if (side === "right") return PanelRight;
  return PanelBottom;
}

function hideIcon(side: DockSide) {
  if (side === "top") return ChevronUp;
  if (side === "left") return ChevronLeft;
  if (side === "right") return ChevronRight;
  return ChevronDown;
}

function ProjectTerminalDockComponent({
  dock,
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
  onCloseOtherTerminals,
  onReorderTerminals,
  onTerminalMetaChange,
}: Props) {
  useLocale();
  const vertical = isVerticalDock(dock.side);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sidebarResize = useDragResize({
    min: 80,
    max: () =>
      Math.min(480, Math.max(0, (bodyRef.current?.clientWidth ?? window.innerWidth) - 120)),
    defaultWidth: 200,
    initial: 200,
  });
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [profileMenu, setProfileMenu] = useState<HTMLElement | null>(null);
  const [terminalMenu, setTerminalMenu] = useState<{
    x: number;
    y: number;
    id: string;
  } | null>(null);
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
  const drag = useRef<{ start: number; size: number } | null>(null);
  const sizeRef = useRef(dock.size);
  sizeRef.current = dock.size;
  const pending = useRef(dock.size);
  const frame = useRef<number | null>(null);
  const SideIcon = sideIcon(dock.side);
  const HideIcon = hideIcon(dock.side);
  const visibleIds = dockTerminalGroup(dock, dock.pane.activeFileId);
  const splitTerminal = (id: string) => {
    onSplitTerminal?.(id);
  };

  useEffect(() => {
    if (!dragging) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = vertical ? "row-resize" : "col-resize";
    return () => {
      document.body.style.cursor = previous;
    };
  }, [dragging, vertical]);

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

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      start: vertical ? event.clientY : event.clientX,
      size: sizeRef.current,
    };
    pending.current = sizeRef.current;
    setDragging(true);
  };

  const onResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const point = vertical ? event.clientY : event.clientX;
    const delta = point - drag.current.start;
    const signed = dock.side === "bottom" || dock.side === "right" ? -delta : delta;
    paint(clampDockSize(dock.side, drag.current.size + signed, viewport()));
  };

  const onResizePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    commit();
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const sash =
    dock.side === "top"
      ? "absolute inset-x-0 -bottom-px z-10 h-1.5 cursor-row-resize touch-none"
      : dock.side === "bottom"
        ? "absolute inset-x-0 -top-px z-10 h-1.5 cursor-row-resize touch-none"
        : dock.side === "left"
          ? "absolute inset-y-0 -right-px z-10 w-1.5 cursor-col-resize touch-none"
          : "absolute inset-y-0 -left-px z-10 w-1.5 cursor-col-resize touch-none";

  return (
    <section
      data-project-terminal-dock=""
      className={`project-terminal-dock relative flex h-full min-h-0 min-w-0 ${
        dock.side === "top"
          ? "border-b"
          : dock.side === "bottom"
            ? "border-t"
            : dock.side === "left"
              ? "border-r"
              : "border-l"
      } border-stroke`}
      onMouseDown={onFocus}
    >
      <div
        role="separator"
        aria-orientation={vertical ? "horizontal" : "vertical"}
        aria-label={t("Resize terminal")}
        aria-valuenow={dock.size}
        className={`${sash} terminal-dock-sash`}
        data-dragging={dragging || undefined}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        onDoubleClick={() => {
          pending.current = defaultDockSize(dock.side);
          commit();
        }}
      />
      <header className="terminal-header">
        <span className="terminal-header-title">{t("Terminals")}</span>
        <div className="terminal-toolbar">
          <div className="flex min-w-0 items-center gap-0.5">
            <IconButton
              label={t("New Terminal ({p0}`)", { p0: MOD })}
              onClick={() => {
                onAddTerminal();
              }}
            >
              <Plus className="icon-sm" strokeWidth={1.75} />
            </IconButton>
            {onAddTerminalWithProfile ? (
              <div ref={profileButton} className="terminal-profile-trigger">
                <IconButton
                  label={t("Launch Profile…")}
                  active={!!profileMenu}
                  onClick={() => {
                    setMenu(null);
                    setProfileMenu(profileMenu ? null : profileButton.current);
                  }}
                >
                  <ChevronDown className="icon-sm" strokeWidth={1.75} />
                </IconButton>
              </div>
            ) : null}
            {onSplitTerminal ? (
              <IconButton label={t("Split")} onClick={() => splitTerminal(dock.pane.activeFileId)}>
                <SplitSquare className="icon-sm" strokeWidth={1.75} />
              </IconButton>
            ) : null}
            <div ref={sideButton}>
              <IconButton
                label={t("Terminal dock actions")}
                active={!!menu}
                onClick={() => {
                  setProfileMenu(null);
                  setMenu(menu ? null : sideButton.current);
                }}
              >
                <MoreHorizontal className="icon-sm" strokeWidth={1.75} />
              </IconButton>
            </div>
            <IconButton label={t("Hide Terminal ({p0}J)", { p0: MOD })} onClick={onHide}>
              <X className="icon-sm" strokeWidth={1.75} />
            </IconButton>
          </div>
        </div>
      </header>
      <div className="terminal-body" ref={bodyRef}>
        <aside
          ref={sidebarResize.setPaneRef}
          className="terminal-sidebar"
          aria-label={t("Terminal controls")}
        >
          <div
            className="terminal-list"
            role="tablist"
            aria-label={t("Terminals")}
            aria-orientation="vertical"
          >
            {dock.pane.files.map((file, index) => (
              <ActionHost
                key={file.id}
                ref={(el) => sortable.setItemRef(file.id, el)}
                selected={file.id === dock.pane.activeFileId}
                className="terminal-list-row reorder-item"
                role="presentation"
                onPointerDown={(event) => {
                  if (event.button !== 0 || (event.target as HTMLElement).closest("[data-no-drag]"))
                    return;
                  sortable.onItemPointerDown(file.id, event);
                }}
              >
                <Button
                  variant="tab"
                  fullWidth
                  motion="none"
                  id={`terminal-tab-${file.id}`}
                  type="button"
                  role="tab"
                  aria-selected={file.id === dock.pane.activeFileId}
                  aria-controls={`terminal-panel-${file.id}`}
                  tabIndex={file.id === dock.pane.activeFileId ? 0 : -1}
                  className="terminal-list-item"
                  title={`${terminalTabLabel(file)} — ${file.cwd}`}
                  onClick={() => {
                    if (sortable.consumeClick()) return;
                    onSelectTerminal(file.id);
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
                  onKeyDown={(event) => {
                    if (sortable.onItemKeyDown(file.id, event)) return;
                    const files = dock.pane.files;
                    const next =
                      event.key === "ArrowDown"
                        ? (index + 1) % files.length
                        : event.key === "ArrowUp"
                          ? (index - 1 + files.length) % files.length
                          : event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? files.length - 1
                              : null;
                    if (next !== null) {
                      event.preventDefault();
                      onSelectTerminal(files[next].id);
                      document.getElementById(`terminal-tab-${files[next].id}`)?.focus();
                    }
                  }}
                >
                  <Terminal className="icon-sm shrink-0" strokeWidth={1.5} />
                  <span className="min-w-0 flex-1 truncate">{terminalTabLabel(file)}</span>
                </Button>
                <div className="terminal-row-actions">
                  {onSplitTerminal ? (
                    <InlineAction
                      label={`${t("Split")} — ${terminalTabLabel(file)}`}
                      motion="none"
                      type="button"
                      aria-label={`${t("Split")} — ${terminalTabLabel(file)}`}
                      title={t("Split")}
                      onClick={() => splitTerminal(file.id)}
                    >
                      <SplitSquare className="icon-sm" strokeWidth={1.75} />
                    </InlineAction>
                  ) : null}
                  <InlineAction
                    label={`${t("Close")} — ${terminalTabLabel(file)}`}
                    motion="none"
                    type="button"
                    aria-label={`${t("Close")} — ${terminalTabLabel(file)}`}
                    title={t("Close")}
                    onClick={() => onCloseTerminal(file.id)}
                  >
                    <X className="icon-sm" strokeWidth={1.75} />
                  </InlineAction>
                </div>
              </ActionHost>
            ))}
          </div>
        </aside>
        <div
          {...sidebarResize.separatorProps}
          aria-label={`${t("Resize terminal")} — ${t("Terminals")}`}
          className="terminal-sidebar-sash"
          data-dragging={sidebarResize.dragging || undefined}
          onPointerDown={sidebarResize.onPointerDown}
          onDoubleClick={sidebarResize.onDoubleClick}
        />
        <div
          className="terminal-canvas relative min-h-0 min-w-0 flex-1"
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, visibleIds.length)}, minmax(0, 1fr))`,
          }}
        >
          {dock.pane.files.map((file) => (
            <div
              key={file.id}
              id={`terminal-panel-${file.id}`}
              role="tabpanel"
              aria-labelledby={`terminal-tab-${file.id}`}
              aria-hidden={!visibleIds.includes(file.id)}
              onMouseDown={() => onSelectTerminal(file.id)}
              style={{
                gridColumn: visibleIds.indexOf(file.id) + 1,
                borderInlineStart:
                  visibleIds.indexOf(file.id) > 0 ? "1px solid var(--terminal-border)" : undefined,
              }}
              className={visibleIds.includes(file.id) ? "terminal-split-pane" : "hidden"}
            >
              <TerminalView
                id={file.id}
                cwd={file.cwd}
                profile={file.shellProfile}
                active={focused && file.id === dock.pane.activeFileId}
                onMetaChange={(patch) => onTerminalMetaChange?.(file.id, patch)}
              />
            </div>
          ))}
        </div>
      </div>
      {terminalMenu ? (
        <ExplorerMenu
          x={terminalMenu.x}
          y={terminalMenu.y}
          ariaLabel="Terminal actions"
          className="terminal-popup"
          items={[
            ...(onSplitTerminal ? [{ kind: "item" as const, id: "split", label: t("Split") }] : []),
            {
              kind: "item",
              id: "move-up",
              get label() {
                return t("Move up");
              },
              disabled: dock.pane.files.findIndex((file) => file.id === terminalMenu.id) < 1,
            },
            {
              kind: "item",
              id: "move-down",
              get label() {
                return t("Move down");
              },
              disabled:
                dock.pane.files.findIndex((file) => file.id === terminalMenu.id) >=
                dock.pane.files.length - 1,
            },
            { kind: "sep" },
            {
              kind: "item",
              id: "close",
              get label() {
                return t("Close");
              },
            },
            {
              kind: "item",
              id: "close-others",
              get label() {
                return t("Close Others");
              },
              disabled: dock.pane.files.length < 2,
            },
          ]}
          onPick={(id) => {
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
            if (id === "close-others") onCloseOtherTerminals(terminalMenu.id);
            setTerminalMenu(null);
          }}
          onClose={() => setTerminalMenu(null)}
        />
      ) : null}
      {profileMenu ? (
        <ExplorerMenu
          anchor={profileMenu}
          side={dock.side === "top" ? "bottom" : "top"}
          align="end"
          className="terminal-popup"
          ariaLabel="Terminal profiles"
          items={[
            ...(profiles?.profiles ?? []).map((profile) => ({
              kind: "item" as const,
              id: `profile:${profile.id}`,
              label: `${profile.name}${profile.id === defaultProfile ? ` (${t("Default")})` : ""}`,
              checked: profile.id === defaultProfile,
            })),
            ...(onSplitTerminal
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
                    get label() {
                      return t("No shells found");
                    },
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
                    get label() {
                      return t("Select Default Profile…");
                    },
                  },
                ]
              : []),
          ]}
          onPick={(id) => {
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
      {menu ? (
        <ExplorerMenu
          anchor={menu}
          side={dock.side === "top" ? "bottom" : "top"}
          align="end"
          className="terminal-popup"
          ariaLabel={t("Terminal dock actions")}
          items={[
            {
              kind: "item",
              id: "move",
              label: t("Move Terminal"),
              icon: <SideIcon className="icon-sm" />,
              submenu: SIDE_ITEMS.map((item) => ({
                kind: "item" as const,
                id: item.id,
                label: item.label,
                checked: item.id === dock.side,
              })),
            },
            { kind: "sep" },
            {
              kind: "item",
              id: "close",
              label: t("Close Active Terminal"),
              icon: <X className="icon-sm" />,
            },
            {
              kind: "item",
              id: "close-others",
              label: t("Close Others"),
              disabled: dock.pane.files.length < 2,
            },
            {
              kind: "item",
              id: "hide",
              label: t("Hide Terminal ({p0}J)", { p0: MOD }),
              icon: <HideIcon className="icon-sm" />,
            },
          ]}
          onPick={(id) => {
            if (id === "top" || id === "bottom" || id === "left" || id === "right") {
              onSideChange(id);
            }
            if (id === "close") onCloseTerminal(dock.pane.activeFileId);
            if (id === "close-others") onCloseOtherTerminals(dock.pane.activeFileId);
            if (id === "hide") onHide();
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
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
