import { presentRemoteError } from "../../connections/public/remoteFailure";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { WorktreeList, useWorktreeList } from "./WorktreeList";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { worktreeRows } from "../model/worktreeRows";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { PopoverSearchHeader } from "../../../shared/ui/PopoverSearchHeader";
import { t, useLocale } from "../../../shared/i18n/git";
import { useRef, useState } from "react";
import { useProjectBranchesState } from "../hooks/useProjectBranches";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { pathKey, prettyCwd } from "../../../shared/lib/paths";
import { NO_BRANCH_LABEL, type Worktree } from "../model/worktrees";
import { BranchPicker } from "./BranchPicker";
import { CreateWorktreeDialog } from "./CreateWorktreeDialog";
import { GitPickerTrigger } from "./GitPickerTrigger";
import { Popover } from "../../../shared/ui/Popover";
import { GitBranch, Plus, Settings } from "../../../shared/ui/icons";

export function WorktreePicker({
  cwd,
  executionCwd,
  enabled = true,
  opensNewSession = false,
  worktreeRemoved = false,
  onSelect,
  onBranchChange,
  onManage,
  onClose,
}: {
  cwd: string;
  executionCwd: string;
  enabled?: boolean;
  opensNewSession?: boolean;
  worktreeRemoved?: boolean;
  onSelect: (tree: Worktree) => Promise<void>;
  onBranchChange?: () => void;
  onManage?: () => void;
  onClose?: () => void;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [branchPicker, setBranchPicker] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [activePath, setActivePath] = useState<string>();
  const anchor = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const { branches, settled, unreachable } = useProjectBranchesState(
    worktreeRemoved ? cwd : executionCwd,
    !!cwd && cwd !== "~",
  );
  const inWorktree = pathKey(cwd) !== pathKey(executionCwd);
  const {
    data,
    error: loadError,
    refresh,
    loading,
  } = useProjectWorktrees(cwd, enabled && (worktreeRemoved || !!branches?.current || inWorktree));
  if (!enabled && (open || creating || branchPicker)) {
    setOpen(false);
    setCreating(false);
    setBranchPicker(false);
  }
  const dismiss = () => {
    setOpen(false);
    setQuery("");
    setActivePath(undefined);
    onClose?.();
  };
  const select = async (tree: Worktree) => {
    if (busy || tree.missing) return;
    setBusy(true);
    setError(undefined);
    try {
      await onSelect(tree);
      dismiss();
    } catch (e) {
      setError(presentRemoteError(e, { explicit: true }));
    } finally {
      setBusy(false);
    }
  };
  const rows = worktreeRows(data?.worktrees, cwd, query);
  // Default to the current working copy, including when rows arrive after open.
  // Track navigation by path so background refreshes cannot move the highlight.
  const active = Math.max(
    0,
    rows.findIndex((row) => pathKey(row.path) === pathKey(activePath ?? executionCwd)),
  );
  const list = useWorktreeList({
    rows,
    value: worktreeRemoved ? null : executionCwd,
    activePath: rows[active]?.path,
    onActivePathChange: setActivePath,
    inputRef: search,
    disabled: busy,
    onPick: (row) => void select(row.tree),
  });
  if (branchPicker)
    return (
      <BranchPicker
        cwd={executionCwd}
        enabled={enabled}
        worktree={inWorktree}
        initialOpen
        onDismiss={() => setBranchPicker(false)}
        onChange={onBranchChange}
        onClose={() => {
          setBranchPicker(false);
          onClose?.();
        }}
      />
    );
  return (
    <div ref={anchor} className="relative flex min-w-0 shrink">
      <GitPickerTrigger
        disabled={!enabled || (!worktreeRemoved && !branches?.current && !inWorktree)}
        title={
          worktreeRemoved
            ? t("Select a branch or worktree to continue this session")
            : t("Worktree: {p0}", { p0: prettyCwd(executionCwd) })
        }
        aria-label={t("Choose worktree")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setError(undefined);
          setQuery("");
          setActivePath(undefined);
          if (!open) refresh();
          setOpen(!open);
        }}
        label={
          worktreeRemoved
            ? NO_BRANCH_LABEL
            : branches?.current
              ? branches.detached
                ? t("detached {p0}", { p0: branches.current })
                : branches.current
              : settled
                ? inWorktree
                  ? t("Worktree unavailable")
                  : unreachable
                    ? t("Unavailable")
                    : t("No repo")
                : t("Loading…")
        }
        worktree={!worktreeRemoved && inWorktree}
      />
      {open && (
        <Popover
          anchor={anchor}
          side="top"
          minWidth={320}
          maxHeight={400}
          onDismiss={() => {
            if (!busy) dismiss();
          }}
          kind="dialog"
          aria-label={t("Worktrees")}
          data-branch-picker
          className="flex flex-col overflow-hidden"
        >
          <PopoverSearchHeader
            {...list.searchProps}
            label={t("Search worktrees")}
            placeholder={t("Search worktrees…")}
            value={query}
            onValueChange={(value) => {
              setQuery(value);
              setActivePath(undefined);
            }}
            trailing={
              worktreeRemoved || opensNewSession ? (
                <InfoPopover width={240}>
                  {worktreeRemoved
                    ? t("This session’s worktree was deleted. Select a worktree to continue.")
                    : t("Another worktree opens a new session.")}
                </InfoPopover>
              ) : undefined
            }
          />
          <WorktreeList controller={list} loading={!data && !loadError} />
          {(error || loadError) && (
            <InlineError
              className="shrink-0 px-2 py-2"
              retry={
                loadError
                  ? {
                      onRetry: () => void refresh(),
                      pending: loading,
                      disabled: busy,
                    }
                  : undefined
              }
            >
              {error || loadError}
            </InlineError>
          )}
          <Text
            as="div"
            size="caption"
            tone="inherit"
            {...surfaceAttributes({ frame: "pane", edge: "top" }, "shrink-0 p-1")}
          >
            <Button
              variant="item"
              motion="none"
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
              className="flex w-full items-center gap-2 text-left"
            >
              <Plus className="icon-sm" />
              {t("Create worktree…")}
            </Button>
            <Button
              variant="item"
              motion="none"
              type="button"
              disabled={busy || worktreeRemoved}
              onClick={() => {
                setOpen(false);
                setBranchPicker(true);
              }}
              className="flex w-full items-center gap-2 text-left"
            >
              <GitBranch className="icon-sm" />
              {t("Switch branch in this worktree…")}
            </Button>
            {onManage && (
              <Button
                variant="item"
                motion="none"
                type="button"
                disabled={busy}
                onClick={() => {
                  dismiss();
                  onManage();
                }}
                className="flex w-full items-center gap-2 text-left"
              >
                <Settings className="icon-sm" />
                {t("Manage worktrees…")}
              </Button>
            )}
          </Text>
        </Popover>
      )}
      {creating && (
        <CreateWorktreeDialog
          cwd={cwd}
          baseCwd={worktreeRemoved ? cwd : executionCwd}
          defaultRoot={data?.defaultRoot}
          onCreated={async (tree) => {
            setCreating(false);
            setOpen(true);
            await select(tree);
          }}
          onCancel={() => {
            setCreating(false);
            onClose?.();
          }}
        />
      )}
    </div>
  );
}
