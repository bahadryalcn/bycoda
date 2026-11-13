import { Tooltip } from "../../../shared/ui/Tooltip";
import { DiffStat } from "../../../shared/ui/DiffStat";
import { Text } from "../../../shared/ui/Text";
import {
  memo,
  createContext,
  useContext,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ActionHost, InlineAction, InlineMoreAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { Minus, Plus, Undo2 } from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n/git";
import { relativeDirname as dirname } from "../../../shared/lib/paths";
import { FileTypeIcon } from "../../files/public/FileTypeIcon";
import type { TreeSelectionModifiers } from "../../files";
import { useChangedFileMenu } from "../../files/public/useChangedFileMenu";
import { basename, type GitChangedFile, type GitFileDiffKind } from "../../../platform/tauri/fs";

export type ChangeSelection = {
  paths: Set<string>;
  select: (path: string, modifiers?: TreeSelectionModifiers, preserve?: boolean) => void;
  targets: (file: GitChangedFile) => GitChangedFile[];
  action: (file: GitChangedFile, action: "stage" | "unstage" | "discard") => void;
};
export const ChangeSelectionCtx = createContext<ChangeSelection | null>(null);

export const ChangeRow = memo(function ChangeRow({
  file,
  collision = false,
  active,
  busy,
  kind,
  depth,
  style,
  position,
  total,
  onOpenFile,
  onOpenInEditor,
  onAction,
}: {
  file: GitChangedFile;
  collision?: boolean;
  onOpenInEditor?: (path: string, pin?: boolean) => void;
  active: boolean;
  busy: boolean;
  kind: GitFileDiffKind;
  /** Set in tree view: nesting level, and the folder path moves to the tree. */
  depth?: number;
  style?: CSSProperties;
  position?: number;
  total?: number;
  onOpenFile: (path: string, kind: GitFileDiffKind, pin?: boolean) => void;
  onAction: (file: GitChangedFile, action: "stage" | "unstage" | "discard") => void;
}) {
  useLocale();
  const selection = useContext(ChangeSelectionCtx);
  const selected = selection?.paths.size ? selection.paths.has(file.path) : active;
  const perform = (action: "stage" | "unstage" | "discard") =>
    selection ? selection.action(file, action) : onAction(file, action);
  const name = basename(file.relative);
  const tree = depth !== undefined;
  const dir = tree ? "" : dirname(file.relative);
  // A collided name with its folder beside it steps down to the caption role.
  const dimmed = Boolean(collision && dir);
  const canOpen = file.status !== "deleted";
  const {
    menu,
    openFrom,
    isOpen: menuOpen,
    ...menuHandlers
  } = useChangedFileMenu({
    languageDomain: "git",
    path: file.path,
    relative: file.relative,
    deleted: !canOpen,
    selection: () => {
      const chosen = selection?.targets(file) ?? [file];
      return chosen.map((value) => ({
        path: value.path,
        relative: value.relative,
        deleted: value.status === "deleted",
        onOpenChanges: () =>
          chosen.length > 1 ? onOpenFile(value.path, kind, true) : onOpenFile(value.path, kind),
        onOpenFile: onOpenInEditor ? () => onOpenInEditor(value.path, true) : undefined,
      }));
    },
    onOpenChanges: () => onOpenFile(file.path, kind),
    onOpenFile: onOpenInEditor ? () => onOpenInEditor(file.path, true) : undefined,
    actions: [
      {
        id: "index",
        label: kind === "staged" ? "Unstage Changes" : "Stage Changes",
        disabled: busy,
        run: () => perform(kind === "staged" ? "unstage" : "stage"),
      },
      ...(kind === "unstaged"
        ? [
            {
              id: "discard",
              get label() {
                return t("Discard Changes");
              },
              danger: true,
              disabled: busy,
              run: () => perform("discard"),
            },
          ]
        : []),
    ],
  });
  return (
    <li
      style={
        {
          ...style,
          "--control-padding-start": tree ? `${8 + depth * 12}px` : "0.5rem",
        } as CSSProperties
      }
      role="option"
      aria-selected={selected}
      aria-posinset={position}
      aria-setsize={total}
      onContextMenu={(event) => {
        selection?.select(file.path, {}, true);
        menuHandlers.onContextMenu(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
          selection?.select(file.path, {}, true);
        menuHandlers.onKeyDown(event);
      }}
    >
      <ActionHost
        selected={selected}
        hoverReveal
        padding={{ start: "md" }}
        className="flex w-full items-center gap-1"
      >
        <Button
          size="sm"
          controlHeight="fill"
          variant="item"
          motion="none"
          type="button"
          aria-label={file.relative}
          data-git-file={file.path}
          onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
            event.currentTarget.focus({ preventScroll: true });
            selection?.select(file.path, event);
            if (event.ctrlKey || event.metaKey || event.shiftKey) return;
            if (canOpen) onOpenFile(file.path, kind);
          }}
          onDoubleClick={(event) => {
            if (canOpen && !event.ctrlKey && !event.metaKey && !event.shiftKey)
              onOpenFile(file.path, kind, true);
          }}
          className="flex min-w-0 flex-1 select-none items-center gap-1.5 text-left "
        >
          {tree ? <span className="size-4 shrink-0" /> : null}
          <FileTypeIcon name={name} isDir={false} />
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <Text
              size={dimmed ? "caption" : "secondary"}
              tone={dimmed ? "secondary" : "primary"}
              weight={dimmed ? undefined : "medium"}
              truncate
              className={`max-w-full shrink-0 ${file.status === "deleted" ? "line-through" : ""}`}
            >
              {name}
            </Text>
            {dir ? (
              <Text
                as="span"
                size="inherit"
                tone="inherit"
                weight={collision ? "medium" : undefined}
                className="flex min-w-0 flex-1"
              >
                <MiddleTruncate
                  mode="path"
                  title={false}
                  size="caption"
                  tone={collision ? "primary" : "secondary"}
                  className="min-w-0 flex-1"
                >
                  {dir}
                </MiddleTruncate>
              </Text>
            ) : null}
          </span>
        </Button>
        {busy ? <WorkingIndicator label={t("Working")} /> : null}
        {/* Counts and status sit at the row end and yield to the actions on hover, keyboard
            focus or an open menu; they are as wide as the action slot so the actions never
            cover the file name. Discard shares the menu's selection scope and confirmation path. */}
        <Text
          data-action-yield=""
          size="micro"
          tone="primary"
          weight="medium"
          className={`flex shrink-0 items-center justify-end gap-1.5 tabular-nums ${
            kind === "unstaged" ? "pointer-fine:w-17" : "pointer-fine:w-11"
          }`}
        >
          <Tooltip
            label={t("{p0} lines added, {p1} lines removed", {
              p0: file.additions,
              p1: file.deletions,
            })}
            asChild
          >
            <DiffStat additions={file.additions} deletions={file.deletions} />
          </Tooltip>
          <Tooltip label={statusLabel(file.status)} asChild>
            <Text
              size="inherit"
              tone={statusTone(file.status)}

              className="w-3.5 text-center font-mono"
            >
              {statusLetter(file.status)}
            </Text>
          </Tooltip>
        </Text>
        <div
          data-action-slot="collapse"
          className="flex shrink-0 items-center gap-1 pointer-fine:pr-2"
        >
          {kind === "unstaged" && !busy ? (
            <InlineAction label={t("Discard Changes")} onClick={() => perform("discard")}>
              <Undo2 className="icon-sm" strokeWidth={1.75} />
            </InlineAction>
          ) : null}
          {busy ? null : kind === "staged" ? (
            <InlineAction label={t("Unstage Changes")} onClick={() => perform("unstage")}>
              <Minus className="icon-sm" strokeWidth={1.75} />
            </InlineAction>
          ) : (
            <InlineAction label={t("Stage Changes")} onClick={() => perform("stage")}>
              <Plus className="icon-sm" strokeWidth={1.75} />
            </InlineAction>
          )}
          <InlineMoreAction
            label={t("Actions for {p0}", { p0: file.relative })}
            expanded={menuOpen}
            onOpen={(anchor) => {
              selection?.select(file.path, {}, true);
              openFrom(anchor);
            }}
          />
        </div>
      </ActionHost>
      {menu}
    </li>
  );
});

function statusLetter(status: string): string {
  if (status === "untracked") return "U";
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  return "M";
}

function statusLabel(status: string): string {
  if (status === "untracked") return t("Untracked");
  if (status === "added") return t("Added");
  if (status === "deleted") return t("Deleted");
  return t("Modified");
}

// The marker carries the status; plain modifications stay neutral so the list is not an amber wall.
export function statusTone(status: string): "info" | "added" | "removed" | "secondary" {
  if (status === "untracked") return "info";
  if (status === "added") return "added";
  if (status === "deleted") return "removed";
  return "secondary";
}
