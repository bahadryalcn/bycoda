import { presentRemoteError } from "../../connections/public/remoteFailure";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n/git";
import { withGitOperation, useGitPanelState } from "../model/gitPanelState";
import { FolderTree, GitBranch, Plus, RefreshCw } from "../../../shared/ui/icons";
import { TabStrip } from "../../../shared/ui/Tabs";
import { Button } from "../../../shared/ui/Button";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  gitCheckout,
  gitFetch,
  gitCommit,
  gitCreateBranch,
  gitCreateBranchFrom,
  gitStageAll,
  gitStash,
  isCheckoutBlockedByChanges,
  notifyGitChanged,
  type GitBranchInfo,
} from "../../../platform/tauri/fs";
import { useProjectBranchesState } from "../hooks/useProjectBranches";
import { CreateBranchDialog } from "./CreateBranchDialog";
import { GitPickerTrigger } from "./GitPickerTrigger";
import { Badge } from "../../../shared/ui/Badge";
import { InlineError } from "../../../shared/ui/InlineError";
import {
  PickerList,
  PickerPopover,
  PopoverSearchHeader,
  filterPickerOptions,
  usePickerList,
  type PickerOption,
} from "../../../shared/ui/picker";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { SwitchBranchDialog } from "./SwitchBranchDialog";
import { checkoutBlockedFiles } from "../model/checkoutBlockedFiles";

type Props = {
  cwd: string;
  branch?: string;
  enabled?: boolean;
  worktree?: boolean;
  initialOpen?: boolean;
  onDismiss?: () => void;
  onChange?: () => void;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
  popoverSide?: "top" | "bottom";
  /** Working copies in a second tab, so one control chooses the checkout and its branch. */
  checkouts?: CheckoutChoice;
};

export type CheckoutChoice = {
  /** Name of the shown checkout; leads the trigger label. */
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
};

type Tab = "branches" | "checkouts";

type CreateRow = { kind: "create"; name: string };
type BranchRow = { kind: "branch"; branch: GitBranchInfo };
type Row = CreateRow | BranchRow;

type PendingSwitch =
  | { kind: "create"; name: string; reference?: string }
  | { kind: "checkout"; name: string; remote: string | null };

const MENU_MIN_HEIGHT = 180;
const MENU_MAX_HEIGHT = 280;

const branchKey = (entry: GitBranchInfo) => `${entry.remote ?? "local"}:${entry.name}`;

function branchOption(entry: GitBranchInfo): PickerOption {
  return {
    value: branchKey(entry),
    title: (
      <Text
        as="span"
        size="inherit"
        tone="inherit"
        weight={entry.current ? "medium" : undefined}
        className="flex min-w-0"
      >
        <MiddleTruncate mode="text" className="min-w-0 flex-1">
          {entry.name}
        </MiddleTruncate>
      </Text>
    ),
    textValue: entry.name,
    icon: <GitBranch className="icon-sm" strokeWidth={1.75} />,
    meta: entry.remote ? (
      <Badge size="xs" appearance="subtle">
        {entry.remote}
      </Badge>
    ) : undefined,
  };
}

export function BranchPicker({
  cwd,
  branch,
  enabled = true,
  worktree = false,
  initialOpen = false,
  onDismiss,
  onChange,
  onClose,
  onOpenChange,
  popoverSide = "top",
  checkouts,
}: Props) {
  useLocale();
  const [open, setOpen] = useState(initialOpen);
  const [tab, setTab] = useState<Tab>("branches");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [checkoutBusy] = useGitPanelState(cwd, "busy");
  const [error, setError] = useState<string | null>(null);
  const [blockedFiles, setBlockedFiles] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [creatingFrom, setCreatingFrom] = useState(false);
  const [blocked, setBlocked] = useState<PendingSwitch | null>(null);
  const [blockedError, setBlockedError] = useState<string | null>(null);
  const [blockedBusy, setBlockedBusy] = useState<"stash" | "commit" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const surfaceOpen = open || creating || blocked !== null;
  useEffect(() => {
    onOpenChange?.(surfaceOpen);
  }, [surfaceOpen, onOpenChange]);
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);

  const inProject = Boolean(cwd) && cwd !== "~";
  const { branches: projectBranches, settled: branchesSettled } = useProjectBranchesState(
    cwd,
    inProject,
  );

  const current = branch || projectBranches?.current || null;
  const detached = !branch && !!projectBranches?.detached;

  const dismiss = (restore: boolean) => {
    setOpen(false);
    setCreating(false);
    setQuery("");
    setError(null);
    setBusy(false);
    setBlocked(null);
    setBlockedError(null);
    setBlockedBusy(null);
    onDismiss?.();
    if (restore) onCloseRef.current?.();
  };

  // The parent disables git controls during our fetch too; keep its results
  // and errors in this picker while the shared operation lock is held.
  const disabledIdle = !enabled && !fetching;
  if (
    disabledIdle &&
    (open ||
      creating ||
      query !== "" ||
      error !== null ||
      busy ||
      blocked !== null ||
      blockedError !== null ||
      blockedBusy !== null)
  ) {
    setOpen(false);
    setCreating(false);
    setQuery("");
    setError(null);
    setBusy(false);
    setBlocked(null);
    setBlockedError(null);
    setBlockedBusy(null);
  }

  const createName = query.trim();
  const createTaken = (projectBranches?.branches ?? []).some(
    (entry) => !entry.remote && entry.name === createName,
  );
  const createRow: CreateRow | null = createTaken ? null : { kind: "create", name: createName };

  // Rows, option elements and the lowercase search text are built once per branch list (a repository can
  // have thousands of remote refs); a keystroke only filters them and PickerList windows what it mounts.
  const indexed = useMemo(() => {
    const selected = branch || projectBranches?.current;
    return (projectBranches?.branches ?? []).map((entry) => {
      const row: BranchRow = {
        kind: "branch",
        branch: { ...entry, current: entry.name === selected && !entry.remote },
      };
      return {
        row,
        option: branchOption(row.branch),
        hay: (entry.remote ? `${entry.name} ${entry.remote}` : entry.name).toLowerCase(),
      };
    });
  }, [branch, projectBranches]);
  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () => (needle ? indexed.filter((entry) => entry.hay.includes(needle)) : indexed),
    [indexed, needle],
  );
  const rows = useMemo((): BranchRow[] => visible.map((entry) => entry.row), [visible]);

  const applySwitch = (pending: PendingSwitch) =>
    pending.kind === "create"
      ? pending.reference
        ? gitCreateBranchFrom(cwd, pending.name, pending.reference)
        : gitCreateBranch(cwd, pending.name)
      : gitCheckout(cwd, pending.name, pending.remote);

  const finishSwitch = () => {
    notifyGitChanged();
    onChangeRef.current?.();
    dismiss(true);
  };

  const failMessage = (err: unknown) => presentRemoteError(err, { explicit: true });

  const run = async (pending: PendingSwitch, source: "picker" | "dialog" = "picker") => {
    if (busy || blocked) return;
    setBusy(true);
    setError(null);
    try {
      await withGitOperation(cwd, "Switching branch…", () => applySwitch(pending));
      finishSwitch();
    } catch (err) {
      const message = failMessage(err);
      if (isCheckoutBlockedByChanges(message)) {
        setOpen(false);
        setCreating(false);
        setQuery("");
        setError(null);
        setBusy(false);
        setBlockedError(null);
        setBlockedBusy(null);
        setBlockedFiles(checkoutBlockedFiles(message));
        setBlocked(pending);
        return;
      }
      setError(message);
      setBusy(false);
      if (source === "picker") search.current?.focus();
    }
  };

  const resolveBlocked = async (kind: "stash" | "commit", work: () => Promise<unknown>) => {
    if (!blocked || blockedBusy) return;
    setBlockedBusy(kind);
    setBlockedError(null);
    try {
      await withGitOperation(cwd, "Preparing branch switch…", async () => {
        await work();
        await applySwitch(blocked);
      });
      finishSwitch();
    } catch (err) {
      setBlockedError(failMessage(err));
      setBlockedBusy(null);
    }
  };

  const pick = (row: Row) => {
    if (row.kind === "create") {
      if (!row.name) {
        setOpen(false);
        setQuery("");
        setError(null);
        setCreating(true);
        setCreatingFrom(false);
        return;
      }
      void run({ kind: "create", name: row.name });
      return;
    }
    if (row.branch.current) {
      dismiss(true);
      return;
    }
    void run({
      kind: "checkout",
      name: row.branch.name,
      remote: row.branch.remote,
    });
  };

  // Navigation restarts whenever the picker opens or the query changes; a
  // shrinking list clamps the highlighted row during render.
  const options = useMemo((): PickerOption[] => visible.map((entry) => entry.option), [visible]);
  const currentRow = rows.find((row) => row.branch.current);
  const picker = usePickerList({
    options,
    value: currentRow ? branchKey(currentRow.branch) : null,
    onChange: (value) => {
      const row = rows.find((entry) => branchKey(entry.branch) === value);
      if (row) pick(row);
    },
    resetKey: `${open}:${query}`,
  });
  const checkoutTab = Boolean(checkouts) && tab === "checkouts";
  const checkoutPicker = usePickerList({
    options: checkouts ? filterPickerOptions(checkouts.options, query) : [],
    value: checkouts?.value ?? null,
    onChange: (value) => {
      dismiss(false);
      if (value !== checkouts?.value) checkouts?.onChange(value);
    },
    resetKey: `${open}:${tab}:${query}`,
  });
  const list = checkoutTab ? checkoutPicker : picker;

  // Always keep the control mounted so the composer's toolbar does not resize
  // when a folder isn't a git repo. The loading skeleton, "No repo" label, and
  // real branch all share the same icon + 12px line box.
  const awaitingBranch = inProject && !current && !branchesSettled;
  const missingGit = !current && !awaitingBranch;
  const branchLabel = current
    ? detached
      ? t("detached {p0}", { p0: current })
      : current
    : t("No repo");
  const label = checkouts
    ? current
      ? `${checkouts.label} · ${branchLabel}`
      : checkouts.label
    : branchLabel;
  const title = awaitingBranch
    ? t("Loading branch")
    : missingGit && !checkouts
      ? t("No git repository")
      : checkouts
        ? `${t("Worktree")} · ${checkouts.value}`
        : `${t("Switch branch in this worktree…")} · ${label}`;
  // With checkouts the control still switches worktree while a branch is unknown.
  const interactive =
    enabled && !checkoutBusy && (checkouts ? true : !awaitingBranch && !missingGit);

  return (
    <div ref={root} className="relative flex min-w-0 shrink">
      <GitPickerTrigger
        title={title}
        aria-label={
          checkouts
            ? `${t("Worktree")} ${label}`
            : awaitingBranch
              ? t("Loading branch")
              : missingGit
                ? t("No git repository")
                : t("Branch {p0}", { p0: label })
        }
        aria-expanded={missingGit && !checkouts ? undefined : open}
        aria-haspopup={missingGit && !checkouts ? undefined : "dialog"}
        disabled={!interactive}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!interactive || blocked) return;
          if (open) {
            dismiss(true);
            return;
          }
          setQuery("");
          setError(null);
          setTab(current ? "branches" : "checkouts");
          setOpen(true);
        }}
        label={label}
        loading={awaitingBranch && !checkouts}
        worktree={worktree}
      />
      {blocked ? (
        <SwitchBranchDialog
          cwd={cwd}
          branch={blocked.name}
          creating={blocked.kind === "create"}
          busy={blockedBusy}
          error={blockedError}
          files={blockedFiles}
          onStash={() => {
            void resolveBlocked("stash", () =>
              gitStash(cwd, `WIP before switching to ${blocked.name}`),
            );
          }}
          onCommit={(message) => {
            void resolveBlocked("commit", async () => {
              await gitStageAll(cwd);
              await gitCommit(cwd, message);
            });
          }}
          onCancel={() => {
            if (blockedBusy) return;
            setBlocked(null);
            setBlockedError(null);
            onCloseRef.current?.();
          }}
        />
      ) : null}
      {creating ? (
        <CreateBranchDialog
          busy={busy}
          error={error}
          initialName={creatingFrom ? createName : ""}
          branches={creatingFrom ? projectBranches?.branches : undefined}
          initialReference={current ?? undefined}
          onCreate={(name, reference) => {
            void run({ kind: "create", name, reference }, "dialog");
          }}
          onCancel={() => {
            if (busy) return;
            setCreating(false);
            setError(null);
            onCloseRef.current?.();
          }}
        />
      ) : null}
      {open ? (
        <PickerPopover
          open
          anchor={root}
          side={popoverSide}
          size="md"
          minHeight={MENU_MIN_HEIGHT}
          maxHeight={MENU_MAX_HEIGHT}
          onDismiss={(reason) => dismiss(reason === "escape")}
          label={checkouts ? t("Worktree") : t("Branch picker")}
          data-branch-picker=""
          header={
            <>
              {checkouts ? (
                <TabStrip<Tab>
                  label={t("Worktree")}
                  size="sm"
                  fill
                  className="shrink-0"
                  value={tab}
                  onValueChange={(value) => {
                    setTab(value);
                    setQuery("");
                    setError(null);
                    search.current?.focus();
                  }}
                  items={[
                    {
                      value: "checkouts",
                      label: t("Worktrees"),
                      icon: <FolderTree aria-hidden className="icon-sm" />,
                      count: checkouts.options.filter((option) => option.value).length,
                    },
                    {
                      value: "branches",
                      label: t("Branches"),
                      icon: <GitBranch aria-hidden className="icon-sm" />,
                      count: projectBranches?.branches.length ?? null,
                    },
                  ]}
                />
              ) : null}
              <PopoverSearchHeader
                ref={search}
                label={checkoutTab ? t("Search worktrees") : t("Search or create a branch")}
                placeholder={checkoutTab ? t("Search worktrees") : t("Search or create a branch…")}
                value={query}
                onValueChange={(value) => {
                  setQuery(value);
                  setError(null);
                }}
                autoCorrect="off"
                autoCapitalize="off"
                disabled={busy}
                {...list.searchProps}
                onSubmit={() => {
                  if (checkoutTab) {
                    checkoutPicker.commit();
                    return;
                  }
                  if (rows.length > 0) {
                    picker.commit();
                    return;
                  }
                  if (createName && createRow) pick(createRow);
                }}
                trailing={
                  checkoutTab ? undefined : (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      label={t("Fetch")}
                      loading={fetching}
                      loadingLabel={t("Fetching…")}
                      disabled={busy || !!checkoutBusy || !enabled}
                      onClick={async () => {
                        if (busy || checkoutBusy || !enabled) return;
                        setBusy(true);
                        setFetching(true);
                        setError(null);
                        try {
                          await withGitOperation(cwd, "Fetching…", () => gitFetch(cwd));
                          notifyGitChanged(cwd, "refs");
                        } catch (err) {
                          setError(failMessage(err));
                        } finally {
                          setBusy(false);
                          setFetching(false);
                        }
                      }}
                    >
                      <RefreshCw aria-hidden className="icon-sm" />
                    </Button>
                  )
                }
              />
            </>
          }
          footer={
            checkoutTab ? undefined : (
              <div {...surfaceAttributes({ frame: "pane", edge: "top" }, "shrink-0 p-1 px-1.5")}>
                {createRow ? (
                  <Button
                    variant="item"
                    motion="none"
                    type="button"
                    fullWidth
                    align="start"
                    startIcon={<Plus className="icon-md" strokeWidth={1.75} />}
                    disabled={busy}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(createRow)}
                  >
                    <Text size="inherit" tone="inherit" className="flex min-w-0">
                      <MiddleTruncate className="min-w-0">
                        {createRow.name
                          ? t("Create and checkout {p0}", { p0: createRow.name })
                          : t("New branch")}
                      </MiddleTruncate>
                    </Text>
                  </Button>
                ) : null}
                <Button
                  variant="item"
                  motion="none"
                  type="button"
                  fullWidth
                  align="start"
                  startIcon={<GitBranch className="icon-md" strokeWidth={1.75} />}
                  disabled={busy || !projectBranches?.branches.length}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setOpen(false);
                    setError(null);
                    setCreatingFrom(true);
                    setCreating(true);
                  }}
                >
                  <Text size="inherit" tone="inherit" truncate className="min-w-0">
                    {t("New branch from…")}
                  </Text>
                </Button>
              </div>
            )
          }
        >
          {checkoutTab ? (
            <PickerList
              label={t("Worktrees")}
              controller={checkoutPicker}
              emptyLabel={t("No matches")}
            />
          ) : (
            <PickerList
              label={t("Branches")}
              controller={picker}
              disabled={busy}
              emptyLabel={query.trim() ? t("No matching branches") : t("No branches")}
            />
          )}
          {error ? (
            <InlineError
              {...surfaceAttributes(
                { frame: "pane", edge: "top" },
                "max-h-16 shrink-0 overflow-y-auto whitespace-pre-wrap px-2.5 py-2",
              )}
            >
              {error}
            </InlineError>
          ) : null}
        </PickerPopover>
      ) : null}
    </div>
  );
}
