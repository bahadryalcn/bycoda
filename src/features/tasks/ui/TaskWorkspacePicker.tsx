import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { remoteRequest } from "../../connections/model/connections";
import type { RemoteMachine } from "../../connections/model/protocol";
import { hostProjectFor } from "../../automations/model/hostAutomationClient";
import { machineCapabilities } from "../../automations/model/machineSnapshot";
import { HOST_TASK_WORKSPACES, type TaskWorkspace } from "../model/taskWorkspace";

type Tree = { path: string; branch: string | null; missing?: boolean };
type Inventory = { projectId: string; trees: Tree[]; branches: string[]; current: string | null };

/** Uses host paths only; a remote checkout is never resolved on the desktop. */
export function TaskWorkspacePicker({
  machine,
  cwd,
  value,
  onChange,
  disabled = false,
  branchName = false,
  onBusyChange,
  onValidityChange,
}: {
  machine?: RemoteMachine;
  cwd: string;
  value?: TaskWorkspace;
  onChange: (value?: TaskWorkspace) => void;
  disabled?: boolean;
  branchName?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  useLocale();
  const [inventory, setInventory] = useState<Inventory>();
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [supported, setSupported] = useState<boolean | null>(null);
  const machineId = machine?.id;
  const context = useRef("");
  context.current = `${machineId ?? ""}\0${cwd}`;
  const valid =
    !newName.trim() &&
    ((!value?.baseBranch && !value?.checkoutCwd) ||
      Boolean(
        inventory?.trees.some(
          (tree) =>
            Boolean(tree.branch) &&
            (!value?.baseBranch || tree.branch === value.baseBranch) &&
            (!value?.checkoutCwd || tree.path === value.checkoutCwd),
        ),
      ));
  useEffect(() => {
    onValidityChange?.(valid);
  }, [valid, onValidityChange]);
  useEffect(() => {
    let live = true;
    setInventory(undefined);
    setError("");
    setSupported(null);
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
      if (live)
        setInventory({
          projectId: project.id,
          trees: trees.worktrees.filter((tree) => !tree.missing),
          ...branches,
        });
    })().catch((reason) => {
      if (live) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      live = false;
    };
  }, [machineId, cwd, revision]);

  const create = async (existing: boolean) => {
    if (!machine || !inventory || busy) return;
    const branch = existing ? value?.baseBranch : newName.trim();
    if (!branch) return;
    setBusy(true);
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
      setNewName("");
      setRevision((count) => count + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  return (
    <fieldset disabled={disabled || busy} className="task-workspace-fields">
      <legend>{t("Working branch and worktree")}</legend>
      {supported === false ? (
        <p>{t("Update the selected host to choose a branch or worktree.")}</p>
      ) : null}
      {error ? (
        <div role="alert">
          {error}
          <button type="button" onClick={() => setRevision((count) => count + 1)}>
            {t("Retry")}
          </button>
        </div>
      ) : null}
      {inventory ? (
        <>
          <label>
            {t("Base branch")}
            <SearchableSelect
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
          </label>
          <label>
            {t("Worktree")}
            <SearchableSelect
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
          </label>
          {value?.baseBranch &&
          !inventory.trees.some((tree) => tree.branch === value.baseBranch) ? (
            <button type="button" onClick={() => void create(true)}>
              {t("Create worktree for this branch")}
            </button>
          ) : null}
          <label>
            {t("New integration branch")}
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="goal/settings"
              spellCheck={false}
            />
          </label>
          <button type="button" disabled={!newName.trim()} onClick={() => void create(false)}>
            {busy ? t("Creating…") : t("Create a separate worktree")}
          </button>
          <p>
            {t(
              "Tasks start from committed changes. A separate integration worktree keeps the queue independent of edits in your project checkout.",
            )}
          </p>
          {branchName ? (
            <label>
              {t("Task branch name (optional)")}
              <input
                value={value?.branchName ?? ""}
                onChange={(event) =>
                  onChange({ ...value, branchName: event.target.value || undefined })
                }
                placeholder="mc/…"
                spellCheck={false}
              />
            </label>
          ) : null}
        </>
      ) : supported && !error ? (
        <p role="status">{t("Loading…")}</p>
      ) : null}
    </fieldset>
  );
}
