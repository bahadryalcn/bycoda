import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { SessionFolder } from "../../features/sessions/model/sessionFolders";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import { folderAccent } from "../../features/sessions/model/sessionFolders";
import { TerminalSpinner } from "../../features/sessions/ui/TerminalSpinner";
import { ActionHost, InlineAction, InlineMoreAction } from "../../shared/ui/ActionHost";
import { Button } from "../../shared/ui/Button";
import { TextField } from "../../shared/ui/TextField";
import { useT } from "../../shared/i18n";
import { Check, ChevronRight, CircleAlert, Folder, FolderOpen, Plus } from "../../shared/ui/icons";

export function FolderRow({
  folder,
  nameNode,
  sessions,
  expanded,
  busy,
  done,
  needsApproval,
  groupIcon,
  onPointerDown,
  onToggle,
  onContextMenu,
  onRename,
  onNewSession,
  onOpenMenu,
  menuOpen,
}: {
  folder: Pick<SessionFolder, "name" | "colorIndex" | "customColor">;
  nameNode?: ReactNode;
  sessions: SessionSummary[];
  expanded: boolean;
  busy: boolean;
  done: boolean;
  needsApproval: boolean;
  groupIcon?: ReactNode;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onToggle: () => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onRename?: () => void;
  onNewSession?: () => void;
  onOpenMenu?: (anchor: HTMLButtonElement) => void;
  menuOpen?: boolean;
}) {
  const t = useT();
  const count = sessions.length;
  const accent = folderAccent(folder.colorIndex, folder.customColor);
  const actionCount = (onNewSession ? 1 : 0) + (onOpenMenu ? 1 : 0);
  const header = (
    <Button
      variant="item"
      motion="none"
      type="button"
      tooltip={folder.name}
      tooltipWhen="overflow"
      tooltipDetails={[busy ? t("Working") : null, needsApproval ? t("Needs input") : null]}
      tooltipWide
      data-folder-row=""
      aria-expanded={expanded}
      data-tauri-drag-region="false"
      onPointerDown={onPointerDown}
      onClick={onToggle}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        if (event.key === "F2" && onRename) {
          event.preventDefault();
          onRename();
          return;
        }
        if (
          onOpenMenu &&
          (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
        ) {
          event.preventDefault();
          onOpenMenu(event.currentTarget);
        }
      }}
      className="group relative flex min-h-7 w-full min-w-0 touch-none items-center gap-1.5 px-2.5 py-1 text-start"
    >
      <span
        aria-hidden
        className={`relative grid size-4 shrink-0 place-items-center ${accent ? "" : "text-(--ui-text-muted)"}`}
        style={accent ? { color: accent } : undefined}
      >
        <span className="contents group-hover:hidden group-focus-visible:hidden">
          {groupIcon ??
            (expanded ? (
              <FolderOpen className="icon-sm" strokeWidth={1.75} />
            ) : (
              <Folder className="icon-sm" strokeWidth={1.75} />
            ))}
        </span>
        <ChevronRight
          className={`hidden icon-sm text-(--ui-text-secondary) transition-transform duration-150 ease-out motion-reduce:transition-none group-hover:block group-focus-visible:block ${expanded ? "rotate-90" : ""}`}
          strokeWidth={1.75}
        />
      </span>
      <span className="relative min-w-0 flex-1 truncate text-ui-secondary font-medium leading-snug text-(--ui-text-secondary) group-hover:text-content group-focus-visible:text-content">
        {nameNode ?? folder.name}
      </span>
      <span className="relative flex shrink-0 items-center gap-1.5 text-ui-micro tabular-nums text-(--ui-text-muted)">
        {busy ? (
          <span role="img" aria-label={t("Working")}>
            <TerminalSpinner />
          </span>
        ) : null}
        {needsApproval ? (
          <span role="img" aria-label={t("Needs input")}>
            <CircleAlert className="icon-xs text-warning" strokeWidth={1.75} />
          </span>
        ) : !expanded && !busy && done ? (
          <Check className="icon-xs text-success" strokeWidth={2} />
        ) : null}
        <span
          data-action-yield={actionCount ? "" : undefined}
          className={`text-end ${actionCount === 2 ? "pointer-fine:w-10" : actionCount === 1 ? "pointer-fine:w-5" : ""}`}
        >
          {count}
        </span>
      </span>
    </Button>
  );
  if (!actionCount) return header;
  const newSessionLabel = t("New session");
  return (
    <ActionHost className="w-full">
      {header}
      <span data-action-slot="collapse" className="flex shrink-0 items-center pe-2">
        {onNewSession ? (
          <InlineAction
            label={newSessionLabel}
            tooltipDetails={[folder.name]}
            motion="none"
            type="button"
            data-no-drag
            data-tauri-drag-region="false"
            aria-label={`${newSessionLabel}: ${folder.name}`}
            onClick={onNewSession}
          >
            <Plus className="icon-xs shrink-0" strokeWidth={1.75} />
          </InlineAction>
        ) : null}
        {onOpenMenu ? (
          <InlineMoreAction
            label={t("Actions for {p0}", { p0: folder.name })}
            tooltip={t("More actions")}
            tooltipDetails={[folder.name]}
            motion="none"
            type="button"
            data-no-drag
            data-tauri-drag-region="false"
            expanded={menuOpen}
            onOpen={onOpenMenu}
          />
        ) : null}
      </span>
    </ActionHost>
  );
}

export function FolderRenameRow({
  folder,
  memberCount,
  onCommit,
  onCancel,
}: {
  folder: SessionFolder;
  memberCount: number;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const [value, setValue] = useState(folder.name);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);
  const finish = (success: boolean) => {
    if (finished.current) return;
    if (success) {
      const trimmed = value.trim();
      if (!trimmed) {
        onCancel();
        return;
      }
      finished.current = true;
      onCommit(trimmed);
      return;
    }
    finished.current = true;
    onCancel();
  };
  return (
    <div
      data-folder-row=""
      className="relative flex min-h-7 w-full items-center gap-1.5 px-2.5 py-0.5 text-content"
    >
      <span className="relative grid size-4 shrink-0 place-items-center text-(--ui-text-muted)">
        <FolderOpen className="icon-sm" strokeWidth={1.75} />
      </span>
      <TextField
        fieldClassName="min-w-0 flex-1"
        hideLabel
        label={t("Name")}
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        }}
        className="relative min-w-0 flex-1 leading-snug"
      />
      <span className="relative shrink-0 text-ui-micro tabular-nums text-(--ui-text-muted)">
        {memberCount}
      </span>
    </div>
  );
}
