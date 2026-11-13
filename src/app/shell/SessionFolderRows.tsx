import { actionContentAttributes } from "../../shared/ui/ActionHost";
import { Text } from "../../shared/ui/Text";
import { motionAttributes } from "../../shared/ui/Motion";
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
  const disclosureMotion = motionAttributes(
    { transition: "transform", duration: "standard", easing: "rise" },
    `icon-sm ${expanded ? "rotate-90" : ""}`,
  );
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
      size="sm"
      padding={{ inline: "lg", block: "xs" }}
      className="group relative flex w-full min-w-0 touch-none items-center gap-1.5 text-start"
    >
      <Text
        as="span"
        size="inherit"
        tone={accent ? "inherit" : "muted"}
        aria-hidden
        className="relative grid size-4 shrink-0 place-items-center"
        style={accent ? { color: accent } : undefined}
      >
        <span {...actionContentAttributes({ phase: "rest" }, "contents")}>
          {groupIcon ??
            (expanded ? (
              <FolderOpen className="icon-sm" strokeWidth={1.75} />
            ) : (
              <Folder className="icon-sm" strokeWidth={1.75} />
            ))}
        </span>
        <ChevronRight
          tone="secondary"
          strokeWidth={1.75}
          {...disclosureMotion}
          {...actionContentAttributes({ phase: "interaction" }, disclosureMotion.className)}
        />
      </Text>
      <Text
        as="span"
        truncate
        size="secondary"
        tone="secondary"
        weight="medium"
        leading="snug"
        {...actionContentAttributes(
          { phase: "always", interactionTone: "primary" },
          "relative min-w-0 flex-1",
        )}
      >
        {nameNode ?? folder.name}
      </Text>
      <Text
        size="micro"
        tone="muted"
        className="relative flex shrink-0 items-center gap-1.5 tabular-nums"
      >
        {busy ? (
          <span role="img" aria-label={t("Working")}>
            <TerminalSpinner />
          </span>
        ) : null}
        {needsApproval ? (
          <span role="img" aria-label={t("Needs input")}>
            <CircleAlert className="icon-xs" tone="warning" strokeWidth={1.75} />
          </span>
        ) : !expanded && !busy && done ? (
          <Check className="icon-xs" tone="success" strokeWidth={2} />
        ) : null}
        <span
          data-action-yield={actionCount ? "" : undefined}
          className={`text-end ${actionCount === 2 ? "pointer-fine:w-10" : actionCount === 1 ? "pointer-fine:w-5" : ""}`}
        >
          {count}
        </span>
      </Text>
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
    <Text
      data-folder-row=""
      as="div"
      size="inherit"
      tone="primary"
      className="relative flex min-h-7 w-full items-center gap-1.5 px-2.5 py-0.5"
    >
      <Text
        size="inherit"
        tone="muted"
        className="relative grid size-4 shrink-0 place-items-center"
      >
        <FolderOpen className="icon-sm" strokeWidth={1.75} />
      </Text>
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
        leading="snug"
        className="relative min-w-0 flex-1"
      />
      <Text size="micro" tone="muted" className="relative shrink-0 tabular-nums">
        {memberCount}
      </Text>
    </Text>
  );
}
