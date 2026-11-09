import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { PopoverSearchHeader } from "../../../shared/ui/PopoverSearchHeader";
import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useRef, useState } from "react";
import { useProjectBranchesState } from "../hooks/useProjectBranches";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { pathKey, prettyCwd } from "../../../shared/lib/paths";
import { NO_BRANCH_LABEL, type Worktree } from "../model/worktrees";
import { BranchPicker } from "./BranchPicker";
import { CreateWorktreeDialog } from "./CreateWorktreeDialog";
import { GitPickerTrigger } from "./GitPickerTrigger";
import { Popover } from "../../../shared/ui/Popover";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { Check, FolderTree, GitBranch, Plus, Settings } from "../../../shared/ui/icons";

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
  const activeOption = useRef<HTMLButtonElement>(null);
  const { branches, settled } = useProjectBranchesState(
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
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const rows =
    data?.worktrees.filter((tree) =>
      `${tree.branch ?? "detached"} ${tree.path}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  // Default to the current working copy, including when rows arrive after open.
  // Track navigation by path so background refreshes cannot move the highlight.
  const active = Math.max(
    0,
    rows.findIndex((tree) => pathKey(tree.path) === pathKey(activePath ?? executionCwd)),
  );
  const activeRowPath = rows[active]?.path;
  useEffect(() => {
    if (open) activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [open, active, activeRowPath]);
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
            : t("Working copy: {p0}", { p0: prettyCwd(executionCwd) })
        }
        aria-label={t("Choose working copy")}
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
                  : t("No repo")
                : t("Loading…")
        }
        worktree={!worktreeRemoved && inWorktree}
      />
      {open && (
        <Popover
          anchor={anchor}
          side="top"
          width={320}
          maxHeight={400}
          onDismiss={() => {
            if (!busy) dismiss();
          }}
          role="dialog"
          aria-label={t("Working copies")}
          data-branch-picker
          className="flex flex-col overflow-hidden"
        >
          <PopoverSearchHeader
            label={t("Search working copies")}
            placeholder={t("Search working copies…")}
            value={query}
            onValueChange={(value) => {
              setQuery(value);
              setActivePath(undefined);
            }}
            onMove={(move) => {
              if (move !== "next" && move !== "previous") return;
              const next = Math.max(
                0,
                Math.min(rows.length - 1, active + (move === "next" ? 1 : -1)),
              );
              setActivePath(rows[next]?.path);
            }}
            onSubmit={() => {
              if (rows[active]) void select(rows[active]);
            }}
          />
          {worktreeRemoved && (
            <p className="shrink-0 px-3 pt-2 pb-1 text-ui-micro text-(--ui-text-secondary)">
              {t("This session’s worktree was deleted. Select a working copy to continue.")}
            </p>
          )}
          {opensNewSession && !worktreeRemoved && (
            <p className="shrink-0 px-3 pt-2 pb-1 text-ui-micro text-(--ui-text-secondary)">
              {t("Another working copy opens a new session.")}
            </p>
          )}
          <div
            className="min-h-0 overflow-y-auto p-1"
            role="listbox"
            aria-label={t("Working copies")}
          >
            {!data && !loadError && (
              <LoadingText className="p-2">{t("Loading working copies…")}</LoadingText>
            )}
            {rows.map((tree, index) => (
              <Button
                selected={active === index}
                variant="item"
                motion="none"
                key={tree.path}
                ref={index === active ? activeOption : undefined}
                type="button"
                role="option"
                aria-selected={!worktreeRemoved && pathKey(tree.path) === pathKey(executionCwd)}
                disabled={busy || tree.missing}
                onMouseEnter={() => setActivePath(tree.path)}
                onClick={() => void select(tree)}
                tooltip={tree.path}
                className={" flex w-full items-center gap-2 text-left "}
              >
                {tree.isMain ? (
                  <GitBranch className="icon-sm shrink-0 text-(--ui-text-secondary)" />
                ) : (
                  <FolderTree className="icon-sm shrink-0 text-(--ui-text-secondary)" />
                )}
                <span className="min-w-0 flex-1">
                  <MiddleTruncate mode="text" className="text-ui-body">
                    {tree.branch ?? t("Detached {p0}", { p0: tree.head.slice(0, 7) })}
                  </MiddleTruncate>
                  <MiddleTruncate
                    mode="path"
                    className="text-ui-caption text-(--ui-text-secondary)"
                  >
                    {`${tree.isMain ? `${t("Project folder")} · ` : ""}${prettyCwd(tree.path)}${tree.missing ? t(" · Missing") : ""}`}
                  </MiddleTruncate>
                </span>
                {!worktreeRemoved && pathKey(tree.path) === pathKey(executionCwd) && (
                  <Check className="icon-sm" />
                )}
              </Button>
            ))}
            {data && !rows.length && (
              <EmptyState
                size="inline"
                kind="filtered"
                className="px-2"
                description={t("No matching working copies")}
              />
            )}
          </div>
          {(error || loadError) && (
            <InlineError
              className="shrink-0 px-2 py-2"
              retry={
                loadError
                  ? { onRetry: () => void refresh(), pending: loading, disabled: busy }
                  : undefined
              }
            >
              {error || loadError}
            </InlineError>
          )}
          <div className="shrink-0 border-t border-stroke p-1 text-ui-caption">
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
              {t("Switch branch in this working copy…")}
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
          </div>
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
