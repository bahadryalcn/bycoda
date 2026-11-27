import { describeRemoteError } from "../../connections/public/remoteFailure";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { WorktreeList, useWorktreeList } from "./WorktreeList";
import { InfoTooltip } from "../../../shared/ui/InfoPopover";
import { isListedWorktree, worktreeRows } from "../model/worktreeRows";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { NoticeCard } from "../../../shared/ui/NoticeCard";
import { PopoverSearchHeader } from "../../../shared/ui/PopoverSearchHeader";
import { t, useLocale } from "../../../shared/i18n/git";
import { useRef, useState } from "react";
import { useProjectBranchesState } from "../hooks/useProjectBranches";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { pathKey, prettyCwd } from "../../../shared/lib/paths";
import type { Worktree } from "../model/worktrees";
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
  const recoveryAnchor = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const { branches, settled, unreachable } = useProjectBranchesState(
    executionCwd,
    !worktreeRemoved && !!cwd && cwd !== "~",
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
    if (busy || !enabled || !isListedWorktree(tree)) return;
    setBusy(true);
    setError(undefined);
    try {
      await onSelect(tree);
      dismiss();
    } catch (e) {
      const { details, message } = describeRemoteError(e);
      setError(details || message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = () => {
    setError(undefined);
    setQuery("");
    setActivePath(undefined);
    if (!open) refresh();
    setOpen(!open);
  };
  const waitReason = t("Wait for this conversation to finish before changing worktrees.");
  const projectTree =
    worktreeRemoved && !loadError
      ? data?.worktrees.find(
          (tree) => pathKey(tree.path) === pathKey(cwd) && isListedWorktree(tree),
        )
      : undefined;
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
    <div
      ref={anchor}
      className={worktreeRemoved ? "relative mb-1.5 min-w-0" : "relative flex min-w-0 shrink"}
    >
      {worktreeRemoved ? (
        <NoticeCard
          kind="warning"
          title={t("Worktree unavailable")}
          detail={t("The worktree folder is gone. Your conversation and draft are kept.")}
          actions={
            <>
              {projectTree ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={!enabled || busy}
                  disabledReason={enabled ? undefined : waitReason}
                  loading={busy && !open}
                  onClick={() => void select(projectTree)}
                >
                  {projectTree.branch
                    ? t("Continue in {p0}", { p0: projectTree.branch })
                    : t("Continue in project folder")}
                </Button>
              ) : null}
              <div ref={recoveryAnchor}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!enabled || busy}
                  disabledReason={enabled ? undefined : waitReason}
                  aria-haspopup="dialog"
                  aria-expanded={open}
                  onClick={toggle}
                >
                  {t("Choose worktree…")}
                </Button>
              </div>
            </>
          }
        >
          {error && !open ? (
            <InlineError details={error}>{t("Couldn’t select worktree")}</InlineError>
          ) : null}
        </NoticeCard>
      ) : (
        <GitPickerTrigger
          disabled={!enabled || (!branches?.current && !inWorktree)}
          title={t("Worktree: {p0}", { p0: prettyCwd(executionCwd) })}
          aria-label={t("Choose worktree")}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
          label={
            branches?.current
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
          worktree={inWorktree}
        />
      )}
      {open && (
        <Popover
          anchor={worktreeRemoved ? recoveryAnchor : anchor}
          side="top"
          align={worktreeRemoved ? "end" : undefined}
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
              !worktreeRemoved && opensNewSession ? (
                <InfoTooltip label={t("Worktrees")}>
                  {t("Another worktree opens a new session.")}
                </InfoTooltip>
              ) : undefined
            }
          />
          <WorktreeList controller={list} loading={!data && !loadError} />
          {(error || loadError) && (
            <InlineError
              inset="row"
              className="shrink-0"
              details={error || loadError}
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
              {error ? t("Couldn’t select worktree") : t("Couldn’t load worktrees")}
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
              fullWidth
              align="start"
              startIcon={<Plus className="icon-sm" />}
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
            >
              {t("Create worktree…")}
            </Button>
            {!worktreeRemoved && (
              <Button
                variant="item"
                motion="none"
                type="button"
                disabled={busy}
                disabledReason={busy ? t("Wait for the current operation to finish") : undefined}
                fullWidth
                align="start"
                startIcon={<GitBranch className="icon-sm" />}
                onClick={() => {
                  setOpen(false);
                  setBranchPicker(true);
                }}
              >
                {t("Switch branch in this worktree…")}
              </Button>
            )}
            {onManage && (
              <Button
                variant="item"
                motion="none"
                type="button"
                disabled={busy}
                fullWidth
                align="start"
                startIcon={<Settings className="icon-sm" />}
                onClick={() => {
                  dismiss();
                  onManage();
                }}
              >
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
