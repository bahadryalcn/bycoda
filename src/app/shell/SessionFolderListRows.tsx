import type { ReactNode } from "react";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { SessionListEntry } from "../../features/sessions/model/sessionFolders";
import styles from "./Sidebar.module.css";
import { Clock, Pin } from "../../shared/ui/icons";
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
      className={`${virtual.className ?? ""} relative ${styles.folder}`}
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

export function SessionGroupListRow({
  entry,
  virtual,
  expanded,
  busy,
  done,
  needsApproval,
  nameNode,
  folder,
  onToggle,
}: {
  entry: Extract<SessionListEntry, { kind: "pinned" | "reminders" }>;
  virtual: SessionListVirtualProps;
  expanded: boolean;
  busy: boolean;
  done: boolean;
  needsApproval: boolean;
  nameNode: ReactNode;
  folder: Pick<
    import("../../features/sessions/model/sessionFolders").SessionFolder,
    "name" | "colorIndex" | "customColor"
  >;
  onToggle: () => void;
}) {
  const reminders = entry.kind === "reminders";
  const sessions: SessionSummary[] =
    entry.kind === "pinned"
      ? [...entry.folders.flatMap((folder) => folder.allSessions), ...entry.sessions]
      : entry.sessions;
  return (
    <li
      {...virtual}
      key={`${entry.kind}-sessions`}
      data-pinned-sessions={reminders ? undefined : ""}
      data-reminder-sessions={reminders ? "" : undefined}
      data-section-divided=""
      data-section-collapsed={expanded ? undefined : ""}
      className={`${virtual.className ?? ""} relative ${styles.folder}`}
      style={virtual.style}
    >
      <div className="overflow-hidden rounded-md">
        <FolderRow
          folder={folder}
          nameNode={nameNode}
          sessions={sessions}
          expanded={expanded}
          busy={busy}
          done={done}
          needsApproval={needsApproval}
          groupIcon={
            reminders ? (
              <Clock className="icon-sm" strokeWidth={1.75} />
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
