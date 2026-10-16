import { SearchInput } from "../../../shared/ui/SearchInput";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { pathKey } from "../../../shared/lib/paths";
import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n/git";
import { Check, GitBranch, MoreHorizontal, Plus } from "../../../shared/ui/icons";
import {
  gitBranches,
  gitCheckout,
  gitCreateBranchFrom,
  gitDeleteRemoteBranch,
  gitMerge,
  gitRebase,
  gitRenameBranch,
  type GitBranchInfo,
} from "../../../platform/tauri/fs";
import { useCallback } from "react";
import { useGitResource } from "../hooks/useGitResource";
import { deleteLocalBranch } from "../model/deleteBranch";
import { confirmNative } from "../model/gitConfirmation";
import { ExplorerMenu, type ExplorerMenuItem } from "../../files/ui/ExplorerMenu";
import { RefNameDialog } from "./RefNameDialog";

export type GraphRun = (label: string, action: () => Promise<unknown>) => Promise<boolean>;
const reference = (branch: GitBranchInfo) =>
  branch.remote ? `${branch.remote}/${branch.name}` : branch.name;

export function GitGraphBranches({
  cwd,
  disabled,
  run,
}: {
  cwd: string;
  disabled: boolean;
  run: GraphRun;
}) {
  useLocale();
  const read = useCallback(() => gitBranches(cwd), [cwd]);
  const { data, error, loading, refresh } = useGitResource(
    cwd,
    `graph-branches:${cwd}`,
    true,
    read,
  );
  const [query, setQuery] = useRetainedState(`git-branches:${pathKey(cwd)}:query`, "");
  const [menu, setMenu] = useState<{
    branch: GitBranchInfo;
    anchor: HTMLElement;
  } | null>(null);
  const [naming, setNaming] = useState<{
    reference: string;
    rename?: boolean;
  } | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const branches = (data?.branches ?? []).filter((branch) =>
    reference(branch).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const create = (ref: string) => {
    setNameError(null);
    setNaming({ reference: ref });
  };
  const pick = async (id: string, branch: GitBranchInfo) => {
    const ref = reference(branch);
    if (id === "create") return create(ref);
    if (id === "rename") {
      setNameError(null);
      setNaming({ reference: branch.name, rename: true });
      return;
    }
    if (id === "delete") {
      await run("Deleting branch…", () => deleteLocalBranch(cwd, branch.name));
      return;
    }
    if (id === "delete-remote" && branch.remote) {
      if (
        await confirmNative(
          t("Delete {p0} from the remote for everyone?", { p0: ref }),
          t("Delete"),
        )
      )
        await run("Deleting remote branch…", () =>
          gitDeleteRemoteBranch(cwd, branch.remote!, branch.name),
        );
      return;
    }
    await run("Updating branches…", () =>
      id === "merge"
        ? gitMerge(cwd, ref)
        : id === "rebase"
          ? gitRebase(cwd, ref)
          : gitCheckout(cwd, branch.name, branch.remote),
    );
  };
  const items = (branch: GitBranchInfo): ExplorerMenuItem[] => [
    {
      kind: "item",
      id: "checkout",
      label: t("Checkout"),
      disabled: branch.current && !branch.remote,
    },
    { kind: "item", id: "create", label: t("Create branch from here…") },
    { kind: "sep" },
    {
      kind: "item",
      id: "merge",
      label: t("Merge into current branch"),
      disabled: branch.current || !!data?.detached,
    },
    {
      kind: "item",
      id: "rebase",
      label: t("Rebase current branch onto here"),
      disabled: branch.current || !!data?.detached,
    },
    ...(!branch.remote
      ? [{ kind: "item" as const, id: "rename", label: t("Rename Branch…") }]
      : []),
    { kind: "sep" },
    {
      kind: "item",
      id: branch.remote ? "delete-remote" : "delete",
      label: t(branch.remote ? "Delete from remote…" : "Delete Branch…"),
      danger: true,
      disabled: branch.current && !branch.remote,
    },
  ];
  return (
    <section aria-label={t("Branches")} className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-content/65">
          {t("Branches")}
        </h3>
        <button
          type="button"
          aria-label={t("New branch")}
          title={t("New branch")}
          disabled={disabled}
          onClick={() => create("HEAD")}
          className="grid size-7 place-items-center rounded hover:bg-content/10 disabled:opacity-40"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <label className="mx-2 mb-2">
        <span className="sr-only">{t("Filter branches")}</span>
        <SearchInput
          standalone
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Filter branches")}
          containerClassName="w-full"
          className="h-7 rounded border border-stroke bg-content/5 px-2 text-[12px] outline-none focus:border-accent"
        />
      </label>
      <div className="min-h-0 overflow-y-auto pb-3">
        {error ? (
          <div role="alert" className="px-3 text-[12px] text-danger">
            {error}
            <button onClick={refresh} className="ml-2 underline">
              {t("Retry")}
            </button>
          </div>
        ) : null}
        {loading && !data ? (
          <p role="status" className="px-3 text-[12px] text-content/60">
            {t("Loading branches…")}
          </p>
        ) : null}
        {data?.detached ? (
          <p className="px-3 py-1 text-[12px] text-warning">{t("Detached HEAD")}</p>
        ) : null}
        {[false, true].map((remote) => (
          <div key={String(remote)}>
            <h4 className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wide text-content/50">
              {t(remote ? "Remotes" : "Local")}
            </h4>
            {branches
              .filter((b) => !!b.remote === remote)
              .map((branch) => (
                <div
                  key={reference(branch)}
                  className={`group flex h-8 items-center px-2 ${branch.current && !remote ? "bg-selection text-content" : "text-content/75 hover:bg-content/5"}`}
                >
                  <button
                    type="button"
                    disabled={disabled || (branch.current && !remote)}
                    title={t("Switch to {p0}", { p0: reference(branch) })}
                    aria-label={t("Switch to {p0}", { p0: reference(branch) })}
                    onClick={() => void pick("checkout", branch)}
                    className="flex h-full min-w-0 flex-1 items-center gap-2 text-left text-[12px] disabled:opacity-70"
                  >
                    {branch.current && !remote ? (
                      <Check className="size-3.5 shrink-0 text-accent" />
                    ) : (
                      <GitBranch className="size-3.5 shrink-0" />
                    )}
                    <span className="truncate">{reference(branch)}</span>
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={t("Actions for {p0}", {
                      p0: reference(branch),
                    })}
                    onClick={(e) => setMenu({ branch, anchor: e.currentTarget })}
                    className="grid size-7 shrink-0 place-items-center rounded hover:bg-content/10 disabled:opacity-40"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </div>
              ))}
          </div>
        ))}
        {!loading && branches.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-content/55">{t("No matching branches")}</p>
        ) : null}
      </div>
      {menu ? (
        <ExplorerMenu
          anchor={menu.anchor}
          ariaLabel={t("Branch actions")}
          items={items(menu.branch)}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            const branch = menu.branch;
            setMenu(null);
            void pick(id, branch);
          }}
        />
      ) : null}
      {naming ? (
        <RefNameDialog
          title={t(naming.rename ? "Rename Branch…" : "New branch")}
          description={t("Reference: {p0}", { p0: naming.reference })}
          label={t("Branch name")}
          placeholder="feature/my-branch"
          initialValue={naming.rename ? naming.reference : ""}
          submitLabel={naming.rename ? "Save" : "Create"}
          busy={disabled}
          error={nameError}
          onCancel={() => setNaming(null)}
          onSubmit={(name) =>
            void run("Updating branches…", async () => {
              try {
                if (naming.rename) await gitRenameBranch(cwd, naming.reference, name);
                else await gitCreateBranchFrom(cwd, name, naming.reference);
                setNaming(null);
              } catch (error) {
                setNameError(String(error));
                throw error;
              }
            })
          }
        />
      ) : null}
    </section>
  );
}
