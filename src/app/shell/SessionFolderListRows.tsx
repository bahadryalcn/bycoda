import { actionDragAttributes } from "../../shared/ui/ActionHost";
import { useState, type CSSProperties, type ReactNode } from "react";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { SessionListEntry } from "../../features/sessions/model/sessionFolders";
import styles from "./Sidebar.module.css";
import { t, useT } from "../../shared/i18n";
import { confirmInApp } from "../../shared/model/appConfirm";
import { ContextMenu, type ContextMenuItem } from "../../shared/ui/ContextMenu";
import { CheckCheck, Clock, Pin } from "../../shared/ui/icons";
import { FolderRow, FolderRenameRow } from "./SessionFolderRows";
import type { FolderEntry, SessionListVirtualProps } from "./sessionListWindow";
import { surfaceAttributes } from "../../shared/ui/Surface";

export function SessionFolderListHeader({
  entry,
  depth,
  virtual,
  expanded,
  renaming,
  busy,
  done,
  needsApproval,
  nameNode,
  menuOpen,
  onRenameCommit,
  onRenameCancel,
  onPointerDown,
  onToggle,
  onContextMenu,
  onRename,
  onNewSession,
  onOpenMenu,
}: {
  entry: FolderEntry;
  depth: number;
  virtual: SessionListVirtualProps;
  expanded: boolean;
  renaming: boolean;
  busy: boolean;
  done: boolean;
  needsApproval: boolean;
  nameNode: ReactNode;
  menuOpen: boolean;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  onPointerDown?: React.PointerEventHandler<HTMLButtonElement>;
  onToggle: () => void;
  onContextMenu: React.MouseEventHandler<HTMLButtonElement>;
  onRename: () => void;
  onNewSession?: () => void;
  onOpenMenu: (anchor: HTMLButtonElement) => void;
}) {
  const topLevel = depth === 0 && !entry.folder.pinned;
  return (
    <li
      {...virtual}
      key={entry.folder.id}
      data-session-folder={entry.folder.id}
      data-folder-collapsed={expanded ? undefined : "true"}
      data-section-divided={topLevel ? "" : undefined}
      data-section-collapsed={expanded ? undefined : ""}
      {...actionDragAttributes(
        { appearance: "faded" },
        `${virtual.className ?? "relative"} ${styles.folder}`,
      )}
      style={
        {
          ...virtual.style,
          "--session-folder-indent": depth ? `${depth * 1.375}rem` : undefined,
        } as CSSProperties
      }
    >
      <div {...surfaceAttributes({ radius: "row" }, "overflow-hidden")}>
        {renaming ? (
          <FolderRenameRow
            folder={entry.folder}
            memberCount={entry.allSessions.length}
            onCommit={onRenameCommit}
            onCancel={onRenameCancel}
          />
        ) : (
          <FolderRow
            folder={entry.folder}
            nameNode={nameNode}
            sessions={entry.allSessions}
            expanded={expanded}
            busy={busy}
            done={done}
            needsApproval={needsApproval}
            onPointerDown={onPointerDown}
            onToggle={onToggle}
            onContextMenu={onContextMenu}
            onRename={onRename}
            onNewSession={onNewSession}
            onOpenMenu={onOpenMenu}
            menuOpen={menuOpen}
          />
        )}
      </div>
    </li>
  );
}

/** Asks before archiving every session on the Settled shelf; archiving can be undone. */
function confirmArchiveAll(count: number): Promise<boolean> {
  return confirmInApp({
    title: t("Archive {p0} settled sessions?", { p0: count }),
    message: t(
      "They move to Archive and leave the list. You can restore them from Archive at any time.",
    ),
    confirmLabel: t("Archive {p0} sessions", { p0: count }),
    tone: "normal",
  });
}

/**
 * The header of a built-in group: Reminders, Pinned or the Settled shelf. The Settled shelf gets a
 * menu that archives or deletes the sessions it lists; deletion confirms in its own owner.
 */
export function SessionGroupListRow({
  entry,
  virtual,
  expanded,
  busyIds,
  doneIds,
  approvalIds,
  reminderColor,
  renderName,
  onToggle,
  onArchiveAll,
  onDeleteAll,
}: {
  entry: Extract<SessionListEntry, { kind: "pinned" | "reminders" | "settled" }>;
  virtual: SessionListVirtualProps;
  expanded: boolean;
  busyIds: ReadonlySet<string>;
  doneIds: ReadonlySet<string>;
  approvalIds: ReadonlySet<string>;
  reminderColor: string;
  /** Draws the group name, e.g. with the list's search highlight. */
  renderName: (name: string) => ReactNode;
  onToggle: () => void;
  /** Settled shelf only: archives the listed sessions. */
  onArchiveAll?: (sessionIds: readonly string[]) => void;
  /** Settled shelf only: deletes the listed sessions after its own confirmation. */
  onDeleteAll?: (sessionIds: readonly string[]) => void;
}) {
  const t = useT();
  const [menu, setMenu] = useState<{ x: number; y: number } | HTMLElement | null>(null);
  const reminders = entry.kind === "reminders";
  const name = reminders ? "Reminders" : entry.kind === "settled" ? t("Settled") : t("Pinned");
  const sessions: SessionSummary[] =
    entry.kind === "pinned"
      ? [...entry.folders.flatMap((folder) => folder.allSessions), ...entry.sessions]
      : entry.sessions;
  const folder = reminders ? { name, customColor: reminderColor } : { name };
  const ids = sessions.map((session) => session.id);
  const menuItems: ContextMenuItem[] =
    entry.kind === "settled" && ids.length
      ? [
          ...(onArchiveAll
            ? [{ kind: "item" as const, id: "archive-all", label: t("Archive all") }]
            : []),
          ...(onDeleteAll
            ? [{ kind: "item" as const, id: "delete-all", label: t("Delete all"), danger: true }]
            : []),
        ]
      : [];
  const onPick = (id: string) => {
    setMenu(null);
    if (id === "delete-all") onDeleteAll?.(ids);
    else if (id === "archive-all")
      void confirmArchiveAll(ids.length)
        .then((confirmed) => confirmed && onArchiveAll?.(ids))
        .catch(() => undefined); // -- an unavailable dialog denies; nothing was archived.
  };
  return (
    <li
      {...virtual}
      key={`${entry.kind}-sessions`}
      data-pinned-sessions={entry.kind === "pinned" ? "" : undefined}
      data-reminder-sessions={reminders ? "" : undefined}
      data-settled-sessions={entry.kind === "settled" ? "" : undefined}
      data-section-divided=""
      data-section-collapsed={expanded ? undefined : ""}
      className={`${virtual.className ?? "relative"} ${styles.folder}`}
      style={virtual.style}
    >
      <div {...surfaceAttributes({ radius: "row" }, "overflow-hidden")}>
        <FolderRow
          folder={folder}
          nameNode={renderName(name)}
          sessions={sessions}
          expanded={expanded}
          busy={sessions.some((session) => busyIds.has(session.id))}
          done={sessions.some((session) => doneIds.has(session.id))}
          needsApproval={sessions.some((session) => approvalIds.has(session.id))}
          groupIcon={
            reminders ? (
              <Clock className="icon-sm" strokeWidth={1.75} />
            ) : entry.kind === "settled" ? (
              <CheckCheck className="icon-sm" strokeWidth={1.75} />
            ) : (
              <Pin className="icon-sm" strokeWidth={1.75} />
            )
          }
          onToggle={onToggle}
          onContextMenu={
            menuItems.length
              ? (event) => {
                  event.preventDefault();
                  setMenu({ x: event.clientX, y: event.clientY });
                }
              : undefined
          }
          onOpenMenu={menuItems.length ? setMenu : undefined}
          menuOpen={menu !== null}
        />
      </div>
      {menu ? (
        <ContextMenu
          {...(menu instanceof HTMLElement ? { anchor: menu } : menu)}
          items={menuItems}
          ariaLabel={t("Settled sessions actions")}
          onPick={onPick}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </li>
  );
}
