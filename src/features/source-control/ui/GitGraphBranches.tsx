import { ActionHost, InlineMoreAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { pathKey } from "../../../shared/lib/paths";
import { useState, useMemo, useDeferredValue } from "react";
import { t, useLocale } from "../../../shared/i18n/git";
import { Check, GitBranch, Plus } from "../../../shared/ui/icons";
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
  const deferredQuery = useDeferredValue(query).trim().toLowerCase();
  const [collapsed, setCollapsed] = useRetainedState(`git-branches:${pathKey(cwd)}:collapsed`, {
    local: false,
    remote: false,
  });
  const branches = useMemo(
    () =>
      (data?.branches ?? [])
        .filter((branch) => reference(branch).toLowerCase().includes(deferredQuery))
        .sort((a, b) => Number(b.current && !b.remote) - Number(a.current && !a.remote)),
    [data?.branches, deferredQuery],
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
      <PaneHeader
        titleAs="h3"
        title={t("Branches")}
        bordered={false}
        actions={
          <Button
            iconOnly
            size="sm"
            label={t("New branch")}
            variant="ghost"
            motion="none"
            type="button"
            disabled={disabled}
            onClick={() => create("HEAD")}
          >
            <Plus className="icon-sm" />
          </Button>
        }
      />
      <label className="mx-2 mb-2">
        <span className="sr-only">{t("Filter branches")}</span>
        <SearchInput
          appearance="field"
          standalone
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Filter branches")}
          containerClassName="w-full"
        />
      </label>
      <div className="min-h-0 overflow-y-auto pb-3">
        {error ? (
          <InlineError className="px-3" retry={{ onRetry: refresh }}>
            {error}
          </InlineError>
        ) : null}
        {loading && !data ? (
          <LoadingText className="px-3 py-1">{t("Loading branches…")}</LoadingText>
        ) : null}
        {data?.detached ? (
          <InlineMessage tone="warning" live="off" className="px-3 py-1">
            {t("Detached HEAD")}
          </InlineMessage>
        ) : null}
        {[false, true].map((remote) => {
          const group = remote ? "remote" : "local";
          const open = !!deferredQuery || !collapsed[group];
          return (
            <div key={String(remote)}>
              <SectionLabel
                className="px-1"
                collapsible
                expanded={open}
                count={branches.filter((b) => !!b.remote === remote).length}
                onExpandedChange={() => setCollapsed({ ...collapsed, [group]: !collapsed[group] })}
              >
                {t(remote ? "Remotes" : "Local")}
              </SectionLabel>
              {open
                ? branches
                    .filter((b) => !!b.remote === remote)
                    .map((branch) => {
                      const current = branch.current && !remote;
                      return (
                        <ActionHost
                          key={reference(branch)}
                          selected={current}
                          className="mx-1 min-h-(--ui-control-height-compact) pe-1"
                        >
                          <Button
                            variant="item"
                            size="sm"
                            motion="none"
                            type="button"
                            disabled={disabled || current}
                            label={t("Switch to {p0}", { p0: reference(branch) })}
                            tooltip={t("Switch to {p0}", { p0: reference(branch) })}
                            onClick={() => void pick("checkout", branch)}
                            className={`min-w-0 flex-1 justify-start gap-2 ${current ? "text-content" : "text-(--ui-text-secondary)"}`}
                          >
                            {current ? (
                              <Check className="icon-sm shrink-0 text-(--ui-tone-accent-fg)" />
                            ) : (
                              <GitBranch className="icon-sm shrink-0" />
                            )}
                            <span className="truncate">{reference(branch)}</span>
                          </Button>
                          <InlineMoreAction
                            label={t("Actions for {p0}", { p0: reference(branch) })}
                            disabled={disabled}
                            expanded={menu?.branch === branch}
                            onOpen={(anchor) => setMenu({ branch, anchor })}
                          />
                        </ActionHost>
                      );
                    })
                : null}
            </div>
          );
        })}
        {!loading && branches.length === 0 ? (
          <EmptyState
            size="inline"
            kind={deferredQuery ? "filtered" : "empty"}
            className="px-3"
            description={t("No matching branches")}
          />
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
