import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { t, useLocale } from "../../../shared/i18n";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { remoteRequest } from "../../connections/public/connections";
import type { RemoteMachine } from "../../connections";
import { hostProjectFor } from "../../automations/model/hostAutomationClient";
import { machineCapabilities } from "../../automations/model/machineSnapshot";
import { HOST_TASK_WORKSPACES, type TaskWorkspace } from "../model/taskWorkspace";
import { presentRemoteError } from "../../connections/public/remoteFailure";

type Tree = { path: string; branch: string | null; missing?: boolean };
type Inventory = { projectId: string; trees: Tree[]; branches: string[]; current: string | null };

/** What the picker knows that its owner cannot: the loaded worktrees and
 * whether an integration branch name is typed but not created yet. The owner
 * derives validity from these and the draft's own workspace value. */
export type WorkspaceChecks = {
  trees?: readonly { path: string; branch: string | null }[];
  scope?: string;
  pendingBranch: boolean;
};

export const INITIAL_WORKSPACE_CHECKS: WorkspaceChecks = { pendingBranch: false };

export function taskWorkspaceScope(machine: RemoteMachine | undefined, cwd: string) {
  return JSON.stringify([machine?.id, machine?.endpoint, machine?.environmentId, cwd]);
}

/** A workspace is usable when no branch name is waiting to be created and any
 * chosen branch or checkout is one of the project's loaded worktrees. */
export function isWorkspaceValid(
  value: TaskWorkspace | undefined,
  checks: WorkspaceChecks,
  scope?: string,
): boolean {
  if (checks.pendingBranch) return false;
  if (!value?.baseBranch && !value?.checkoutCwd) return true;
  if (scope !== undefined && checks.scope !== scope) return false;
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
  render,
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
  /** Mount fields in a caller's popover while keeping controller state here. */
  render?: (fields: ReactNode) => ReactNode;
}) {
  useLocale();
  const [loadedInventory, setInventory] = useState<{ scope: string; data: Inventory }>();
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
  const context = useRef<symbol | undefined>(undefined);
  const latestChange = useRef(onChange);
  const currentContext = taskWorkspaceScope(machine, cwd);
  const inventory = loadedInventory?.scope === currentContext ? loadedInventory.data : undefined;
  const loadKey = `${currentContext}\0${revision}`;
  const fetching = Boolean(machine && cwd) && fetchedKey !== loadKey;
  // Retire writes from the previous target, including a switch away and back.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- swaps the write token when the Host/project target changes so late replies from the old target are dropped
  useLayoutEffect(() => {
    context.current = Symbol();
    return () => {
      context.current = undefined;
    };
  }, [currentContext]);
  // Apply an asynchronous creation to the latest draft so concurrent typing survives.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps the latest draft callback for worktree creation replies that resolve after a re-render
  useLayoutEffect(() => {
    latestChange.current = onChange;
  }, [onChange]);
  const reportChecks = useEffectEvent((patch: Partial<WorkspaceChecks>) => onChecksChange?.(patch));
  const changeNewName = (name: string) => {
    setNewName(name);
    onChecksChange?.({ pendingBranch: Boolean(name.trim()) });
  };
  // Reload only the current Host and project inventory, retiring responses from older reads.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- loads the Host worktree inventory for the current target and ignores replies from older targets
  useEffect(() => {
    let live = true;
    if (fetchedContext.current !== currentContext) {
      setInventory(undefined);
      setError("");
      setSupported(null);
      // A fresh mount starts with an empty branch name; a new project keeps it.
      reportChecks(
        fetchedContext.current === ""
          ? { trees: undefined, scope: currentContext, pendingBranch: false }
          : { trees: undefined, scope: currentContext },
      );
    } else {
      reportChecks({ trees: undefined, scope: currentContext });
    }
    fetchedContext.current = currentContext;
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
        setInventory({
          scope: currentContext,
          data: { projectId: project.id, trees: present, ...branches },
        });
        reportChecks({ trees: present, scope: currentContext });
      }
    })()
      .catch((reason) => {
        // An inventory load is automatic: a passing disconnect stays with the connection notice.
        if (live) setError(presentRemoteError(reason) ?? "");
      })
      .finally(() => {
        if (live) setFetchedKey(loadKey);
      });
    return () => {
      live = false;
    };
  }, [currentContext, revision]);

  const select = (next: TaskWorkspace) => {
    onChange(next.baseBranch || next.checkoutCwd || next.branchName ? next : undefined);
  };

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
      onChecksChange?.({ trees: undefined });
      latestChange.current({ ...value, checkoutCwd: tree.path, baseBranch: tree.branch ?? branch });
      changeNewName("");
      setRevision((count) => count + 1);
    } catch (reason) {
      if (context.current === origin) setError(presentRemoteError(reason, { explicit: true }));
    } finally {
      creating.current = false;
      setCreation(null);
      onBusyChange?.(false);
    }
  };

  const fields = (
    <Text as="div" size="caption" tone="inherit" leading="inherit" className="contents">
      <FieldGroup
        legend={t("Working branch and worktree")}
        hideLegend={headingHidden}
        aria-busy={busy || fetching}
        data-embedded={headingHidden || undefined}
        className="task-workspace-fields"
      >
        {supported === false ? (
          <InlineMessage tone="warning">
            {t("Update the selected host to choose a branch or worktree.")}
          </InlineMessage>
        ) : null}
        {error ? (
          <InlineError
            retry={{
              label: t("Retry"),
              pending: fetching,
              disabled: disabled || busy,
              onRetry: () => setRevision((count) => count + 1),
            }}
          >
            {error}
          </InlineError>
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
                select({
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
                ...inventory.trees
                  .filter((tree) => tree.branch)
                  .map((tree) => ({
                    value: tree.path,
                    label: `${tree.branch ?? t("Detached")} · ${tree.path}`,
                  })),
              ]}
              onChange={(path) =>
                select({
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
              <InfoPopover>
                {t(
                  isolate
                    ? "Tasks start from committed changes. A separate integration worktree keeps the queue independent of edits in your project checkout."
                    : "Direct tasks preserve existing uncommitted changes and write to the selected checkout.",
                )}
              </InfoPopover>
            )}
          </>
        ) : fetching && !error ? (
          <LoadingText />
        ) : null}
        {branchName && supported ? (
          <TextField
            label={t("Task branch name (optional)")}
            value={value?.branchName ?? ""}
            disabled={disabled || busy || fetching}
            onChange={(event) => select({ ...value, branchName: event.target.value || undefined })}
            placeholder="mc/…"
            spellCheck={false}
          />
        ) : null}
      </FieldGroup>
    </Text>
  );
  return render ? render(fields) : fields;
}
