import { Alert } from "../../../shared/ui/Alert";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { remoteRequest } from "../../connections/public/connections";
import type { RemoteMachine } from "../../connections";
import { hostProjectFor } from "../../automations/model/hostAutomationClient";
import { machineCapabilities } from "../../automations/model/machineSnapshot";
import { HOST_TASK_WORKSPACES, type TaskWorkspace } from "../model/taskWorkspace";

type Tree = { path: string; branch: string | null; missing?: boolean };
type Inventory = { projectId: string; trees: Tree[]; branches: string[]; current: string | null };

/** What the picker knows that its owner cannot: the loaded worktrees and
 * whether an integration branch name is typed but not created yet. The owner
 * derives validity from these and the draft's own workspace value. */
export type WorkspaceChecks = {
  trees?: readonly { path: string; branch: string | null }[];
  pendingBranch: boolean;
};

export const INITIAL_WORKSPACE_CHECKS: WorkspaceChecks = { pendingBranch: false };

/** A workspace is usable when no branch name is waiting to be created and any
 * chosen branch or checkout is one of the project's loaded worktrees. */
export function isWorkspaceValid(
  value: TaskWorkspace | undefined,
  checks: WorkspaceChecks,
): boolean {
  if (checks.pendingBranch) return false;
  if (!value?.baseBranch && !value?.checkoutCwd) return true;
  return Boolean(
    checks.trees?.some(
      (tree) =>
        Boolean(tree.branch) &&
        (!value?.baseBranch || tree.branch === value.baseBranch) &&
        (!value?.checkoutCwd || tree.path === value.checkoutCwd),
    ),
  );
}

/** Owner-side state for one picker: pass `patch` as `onChecksChange`. */
export function useWorkspaceChecks() {
  const [checks, setChecks] = useState<WorkspaceChecks>(INITIAL_WORKSPACE_CHECKS);
  const patch = useCallback(
    (next: Partial<WorkspaceChecks>) => setChecks((current) => ({ ...current, ...next })),
    [],
  );
  return [checks, patch] as const;
}

/** Uses host paths only; a remote checkout is never resolved on the desktop. */
export function TaskWorkspacePicker({
  machine,
  cwd,
  value,
  onChange,
  disabled = false,
  branchName = false,
  isolate,
  onBusyChange,
  onChecksChange,
  headingHidden = false,
}: {
  machine?: RemoteMachine;
  cwd: string;
  value?: TaskWorkspace;
  onChange: (value?: TaskWorkspace) => void;
  disabled?: boolean;
  branchName?: boolean;
  isolate?: boolean;
  onBusyChange?: (busy: boolean) => void;
  /** Reports loaded worktrees and a pending branch name as they change. */
  onChecksChange?: (patch: Partial<WorkspaceChecks>) => void;
  /** The owner already shows the "Working branch and worktree" heading (a disclosure
   * summary); the legend stays as the group's accessible name only. */
  headingHidden?: boolean;
}) {
  useLocale();
  const [inventory, setInventory] = useState<Inventory>();
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [creation, setCreation] = useState<"existing" | "new" | null>(null);
  const busy = creation !== null;
  // The load that last finished; a different context or revision is fetching until it does.
  const [fetchedKey, setFetchedKey] = useState<string | null>(null);
  const fetchedContext = useRef("");
  const creating = useRef(false);
  const [revision, setRevision] = useState(0);
  const [supported, setSupported] = useState<boolean | null>(null);
  const machineId = machine?.id;
  const context = useRef("");
  const currentContext = `${machineId ?? ""}\0${cwd}`;
  const loadKey = `${currentContext}\0${revision}`;
  const fetching = Boolean(machine && cwd) && fetchedKey !== loadKey;
  // Committed before the inventory effect below compares it with the loaded one.
  useEffect(() => {
    context.current = currentContext;
  });
  const reportChecks = useEffectEvent((patch: Partial<WorkspaceChecks>) => onChecksChange?.(patch));
  const changeNewName = (name: string) => {
    setNewName(name);
    onChecksChange?.({ pendingBranch: Boolean(name.trim()) });
  };
  useEffect(() => {
    let live = true;
    if (fetchedContext.current !== context.current) {
      setInventory(undefined);
      setError("");
      setSupported(null);
      // A fresh mount starts with an empty branch name; a new project keeps it.
      reportChecks(
        fetchedContext.current === ""
          ? { trees: undefined, pendingBranch: false }
          : { trees: undefined },
      );
    }
    fetchedContext.current = context.current;
    if (!machine || !cwd) return;
    (async () => {
      if (!(await machineCapabilities(machine)).includes(HOST_TASK_WORKSPACES)) {
        if (live) setSupported(false);
        return;
      }
      if (live) setSupported(true);
      const project = await hostProjectFor(machine, cwd);
      const [trees, branches] = await Promise.all([
        remoteRequest<{ worktrees: Tree[] }>(machine.id, "git.worktrees", {
          projectId: project.id,
        }),
        remoteRequest<{ current: string | null; branches: string[] }>(machine.id, "git.branches", {
          projectId: project.id,
        }),
      ]);
      if (live) {
        const present = trees.worktrees.filter((tree) => !tree.missing);
        setError("");
        setInventory({ projectId: project.id, trees: present, ...branches });
        reportChecks({ trees: present });
      }
    })()
      .catch((reason) => {
        if (live) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (live) setFetchedKey(loadKey);
      });
    return () => {
      live = false;
    };
  }, [machineId, cwd, revision]);

  const create = async (existing: boolean) => {
    if (!machine || !inventory || busy || disabled || fetching || creating.current) return;
    const branch = existing ? value?.baseBranch : newName.trim();
    if (!branch) return;
    creating.current = true;
    setCreation(existing ? "existing" : "new");
    setError("");
    onBusyChange?.(true);
    const origin = context.current;
    try {
      const tree = await remoteRequest<Tree>(
        machine.id,
        "git.worktreeCreate",
        {
          projectId: inventory.projectId,
          branch,
          base: value?.baseBranch ?? inventory.current ?? "HEAD",
          existing,
        },
        false,
        true,
      );
      if (context.current !== origin) return;
      onChange({ ...value, checkoutCwd: tree.path, baseBranch: tree.branch ?? branch });
      changeNewName("");
      setRevision((count) => count + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      creating.current = false;
      setCreation(null);
      onBusyChange?.(false);
    }
  };

  return (
    <Text as="div" size="caption" tone="inherit" leading="inherit" className="contents">
      <FieldGroup
        legend={t("Working branch and worktree")}
        hideLegend={headingHidden}
        aria-busy={busy || fetching}
        data-embedded={headingHidden || undefined}
        className="task-workspace-fields"
      >
        {supported === false ? (
          <p>{t("Update the selected host to choose a branch or worktree.")}</p>
        ) : null}
        {error ? (
          <Alert tone="danger">
            {error}
            <Button
              variant="ghost"
              type="button"
              loading={fetching}
              disabled={disabled || busy}
              onClick={() => setRevision((count) => count + 1)}
            >
              {t("Retry")}
            </Button>
          </Alert>
        ) : null}
        {inventory ? (
          <>
            <SearchableSelect
              disabled={disabled || busy || fetching}
              label={t("Base branch")}
              value={value?.baseBranch ?? ""}
              options={[
                { value: "", label: t("Current project branch") },
                ...inventory.branches.map((branch) => ({ value: branch, label: branch })),
              ]}
              onChange={(branch) =>
                onChange({
                  ...value,
                  baseBranch: branch || undefined,
                  checkoutCwd: branch
                    ? inventory.trees.find((tree) => tree.branch === branch)?.path
                    : undefined,
                })
              }
            />
            <SearchableSelect
              disabled={disabled || busy || fetching}
              label={t("Worktree")}
              value={value?.checkoutCwd ?? ""}
              options={[
                { value: "", label: t("Project checkout") },
                ...inventory.trees.map((tree) => ({
                  value: tree.path,
                  label: `${tree.branch ?? t("Detached")} · ${tree.path}`,
                })),
              ]}
              onChange={(path) =>
                onChange({
                  ...value,
                  checkoutCwd: path || undefined,
                  baseBranch: path
                    ? (inventory.trees.find((tree) => tree.path === path)?.branch ?? undefined)
                    : undefined,
                })
              }
            />
            {value?.baseBranch &&
            !inventory.trees.some((tree) => tree.branch === value.baseBranch) ? (
              <Button
                variant="secondary"
                type="button"
                loading={creation === "existing"}
                disabled={disabled || busy || fetching}
                onClick={() => void create(true)}
              >
                {t("Create worktree for this branch")}
              </Button>
            ) : null}
            <TextField
              label={t("New integration branch")}
              value={newName}
              disabled={disabled || busy || fetching}
              onChange={(event) => changeNewName(event.target.value)}
              placeholder="goal/settings"
              spellCheck={false}
            />
            <Button
              variant="ghost"
              type="button"
              disabled={disabled || busy || fetching || !newName.trim()}
              loading={creation === "new"}
              onClick={() => void create(false)}
            >
              {t("Create a separate worktree")}
            </Button>
            {isolate === undefined ? null : (
              <p>
                {t(
                  isolate
                    ? "Tasks start from committed changes. A separate integration worktree keeps the queue independent of edits in your project checkout."
                    : "Direct tasks preserve existing uncommitted changes and write to the selected checkout.",
                )}
              </p>
            )}
            {branchName ? (
              <TextField
                label={t("Task branch name (optional)")}
                value={value?.branchName ?? ""}
                disabled={disabled || busy || fetching}
                onChange={(event) =>
                  onChange({ ...value, branchName: event.target.value || undefined })
                }
                placeholder="mc/…"
                spellCheck={false}
              />
            ) : null}
          </>
        ) : supported && !error ? (
          <LoadingText />
        ) : null}
      </FieldGroup>
    </Text>
  );
}
