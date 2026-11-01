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
import { Minus, Plus } from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n/git";
import { relativeDirname as dirname } from "../../../shared/lib/paths";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import type { TreeSelectionModifiers } from "../../files/model/treeSelection";
import { useChangedFileMenu } from "../../files/ui/useChangedFileMenu";
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
  const canOpen = file.status !== "deleted";
  const { menu, openFrom, isOpen: menuOpen, ...menuHandlers } = useChangedFileMenu({
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
      style={style}
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
        style={tree ? { paddingLeft: 8 + depth * 12 } : undefined}
        className={`flex h-(--ui-control-height-compact) w-full items-center gap-1 pr-2 leading-none ${
          tree ? "" : "pl-2"
        } text-content`}
      >
        <Button
          size="sm"
          variant="item"
          motion="none"
          type="button"
          tooltip={file.relative}
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
          className="flex h-full min-w-0 flex-1 select-none items-center gap-1.5 text-left focus-visible:-outline-offset-1"
        >
          {tree ? <span className="size-4 shrink-0" /> : null}
          <FileTypeIcon name={name} isDir={false} />
          <span className="grid min-w-0 flex-1 grid-cols-2 items-center gap-1.5">
            <span
              className={`min-w-0 truncate ${collision && dir ? "text-ui-caption text-(--ui-text-secondary)" : "max-w-full shrink text-ui-secondary font-medium"} ${
                file.status === "deleted" ? "line-through" : ""
              }`}
            >
              {name}
            </span>
            {dir ? (
              <MiddleTruncate mode="path" className={`min-w-0 flex-1 text-ui-caption ${collision ? "font-medium text-content" : "text-(--ui-text-secondary)"}`}>
                {dir}
              </MiddleTruncate>
            ) : null}
          </span>
        </Button>
        {(
          <span
            className="hidden w-[12ch] shrink-0 grid-cols-2 items-center gap-1 text-right text-ui-micro font-medium tabular-nums @min-[22rem]/changes:grid"
            title={t("{p0} lines added, {p1} lines removed", {
              p0: file.additions,
              p1: file.deletions,
            })}
          >
            <span className="text-diff-add-fg">{file.additions > 0 ? `+${file.additions}` : ""}</span>
            <span className="text-diff-del-fg">{file.deletions > 0 ? `-${file.deletions}` : ""}</span>
          </span>
        )}
        <span
          title={statusLabel(file.status)}
          className={`w-3.5 shrink-0 text-center font-mono text-ui-micro font-semibold ${statusColor(file.status)}`}
        >
          {statusLetter(file.status)}
        </span>
        {/* Fixed-width slots so the row never shifts. Stage/unstage is the frequent action and stays
            direct; More opens the same menu as right-click and the context-menu key (discard, open,
            copy, reveal) for touch and pointer users. Both reveal on hover, focus and selection. */}
        <div className="flex size-5 shrink-0 items-center justify-center">
          {busy ? (
            <WorkingIndicator label={t("Working")} />
          ) : kind === "staged" ? (
            <InlineAction
              label={t("Unstage Changes")}
              disabled={busy}
              onClick={() => perform("unstage")}
            >
              <Minus className="icon-sm" strokeWidth={1.75} />
            </InlineAction>
          ) : (
            <InlineAction label={t("Stage Changes")} disabled={busy} onClick={() => perform("stage")}>
              <Plus className="icon-sm" strokeWidth={1.75} />
            </InlineAction>
          )}
        </div>
        <InlineMoreAction
          label={t("Actions for {p0}", { p0: file.relative })}
          expanded={menuOpen}
          onOpen={(anchor) => {
            selection?.select(file.path, {}, true);
            openFrom(anchor);
          }}
        />
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
export function statusColor(status: string): string {
  if (status === "untracked") return "text-(--ui-tone-info-fg)";
  if (status === "added") return "text-diff-add-fg";
  if (status === "deleted") return "text-diff-del-fg";
  return "text-[var(--ui-text-secondary)]";
}
