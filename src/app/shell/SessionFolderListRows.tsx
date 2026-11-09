import type { ReactNode } from "react";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { SessionListEntry } from "../../features/sessions/model/sessionFolders";
import styles from "./Sidebar.module.css";
import { t } from "../../shared/i18n";
import { CheckCheck, Clock, Pin } from "../../shared/ui/icons";
import { FolderRow, FolderRenameRow } from "./SessionFolderRows";
import type { FolderEntry, SessionListVirtualProps } from "./sessionListWindow";

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
      className={`${virtual.className ?? "relative"} ${styles.folder}`}
      style={{ ...virtual.style, paddingInlineStart: depth ? `${depth * 1.375}rem` : undefined }}
    >
      <div className="overflow-hidden rounded-md">
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

/** The header of a built-in group: Reminders, Pinned or the Settled shelf. */
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
}) {
  const reminders = entry.kind === "reminders";
  const name = reminders ? "Reminders" : entry.kind === "settled" ? t("Settled") : t("Pinned");
  const sessions: SessionSummary[] =
    entry.kind === "pinned"
      ? [...entry.folders.flatMap((folder) => folder.allSessions), ...entry.sessions]
      : entry.sessions;
  const folder = reminders ? { name, customColor: reminderColor } : { name };
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
      <div className="overflow-hidden rounded-md">
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
        />
      </div>
    </li>
  );
}
