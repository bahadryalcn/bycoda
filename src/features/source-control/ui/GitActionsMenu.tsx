import { errorText } from "../../../shared/lib/errors";
import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  Loader,
  MoreHorizontal,
  ArrowDownCircle,
  CloudUpload,
  RefreshCw,
  Plus,
  Check,
} from "../../../shared/ui/icons";
import { ExplorerMenu } from "../../files/ui/ExplorerMenu";
import { Button } from "../../../shared/ui/Button";
import {
  gitBranches,
  gitCreateBranch,
  gitCreateBranchFrom,
  gitCreateTag,
  gitDeleteTag,
  gitFetch,
  gitOperationAbort,
  gitOperationState,
  gitPull,
  gitPush,
  gitRemoteAdd,
  gitRemoteRemove,
  gitRemotes,
  gitRenameBranch,
  gitMerge,
  gitRebase,
  gitStash,
  gitStashAction,
  gitStashClear,
  gitStashList,
  gitSync,
  gitTags,
  gitUndoLastCommit,
  type GitDiffIndex,
  type GitHistoryCommit,
  type GitOperation,
  type GitStashEntry,
  type GitStashMode,
} from "../../../platform/tauri/fs";
import {
  GIT_ACTIONS,
  HOST_UPDATE_NOTICE,
  useRemoteSupports,
} from "../../connections/model/remoteCapabilities";
import { useProjectBranchesState } from "../hooks/useProjectBranches";
import { deleteLocalBranch } from "../model/deleteBranch";
import { operationLabel } from "../model/commitActions";
import {
  commitMenuOptions,
  gitActionsMenuItems,
  type CommitMenuOptions,
} from "../model/gitActionsMenu";
import { BranchManagerDialog } from "./BranchManagerDialog";
import { GitPickDialog, type PickItem } from "./GitPickDialog";
import { stashCommit } from "./GitStashSection";
import { RefNameDialog } from "./RefNameDialog";
import { gitPanelRuntime, setGitFeedback, withGitOperation } from "../model/gitPanelState";
import { appName } from "../../../shared/lib/appName";

/** The `busy` key the menu's own actions hold while they run. */
export const GIT_MENU_BUSY = "git-menu";

/** What the changed-files list exposes so the menu can drive its commit box. */
export type ChangesActions = {
  refreshPr?: () => void;
  commit: (options: CommitMenuOptions) => Promise<void>;
  runAll: (action: "stage" | "unstage" | "discard") => Promise<void>;
};

type Props = {
  toolbar?: boolean;
  onRevealChanges?: () => void;
  cwd: string;
  index: GitDiffIndex | null;
  busy: string | null;
  setBusy: (value: string | null) => void;
  autoFetch: boolean;
  onToggleAutoFetch: () => void;
  changes: RefObject<ChangesActions | null>;
  onStatus: (text: string) => void;
  /** Names the running action ("Pulling…") beside the header spinner. */
  onPending?: (text: string | null) => void;
  /** Reload everything after git ran, whether or not it succeeded. */
  onMutated: () => void;
  onOpenCommit: (commit: GitHistoryCommit, pin?: boolean) => void;
};

/** What the open menu needs beyond the diff index. */
type MenuData = {
  operation: GitOperation | null;
  stashCount: number;
  tagCount: number;
  remoteCount: number;
};

const NO_DATA: MenuData = {
  operation: null,
  stashCount: 0,
  tagCount: 0,
  remoteCount: 0,
};

type Dialog =
  | { kind: "branches" }
  | {
      kind: "pick";
      title: string;
      description?: string;
      placeholder: string;
      emptyText: string;
      items: PickItem[];
      onPick: (id: string) => void;
    }
  | {
      kind: "name";
      title: string;
      description: string;
      label: string;
      placeholder: string;
      submitLabel: string;
      initialValue?: string;
      extra?: { label: string; placeholder: string };
      onSubmit: (name: string, extra: string) => void;
    };

/** A failed lookup counts as "nothing there" rather than breaking the menu. */
async function orElse<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch {
    return fallback;
  }
}

function confirm(text: string, okLabel: string): Promise<boolean> {
  return ask(text, { title: appName(), kind: "warning", okLabel });
}

/** The header "…" button and the source-control menu it opens. */
export function GitActionsMenu({
  toolbar = false,
  onRevealChanges,
  cwd,
  index,
  busy,
  setBusy,
  autoFetch,
  onToggleAutoFetch,
  changes,
  onStatus,
  onPending,
  onMutated,
  onOpenCommit,
}: Props) {
  useLocale();
  // Everything beyond Pull needs this computer or a host with `git.actions`.
  const supported = useRemoteSupports(cwd, GIT_ACTIONS);
  const actions = supported === true;
  const { branches } = useProjectBranchesState(cwd, actions);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<MenuData>(NO_DATA);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const open = anchor !== null;

  useEffect(() => {
    if (!open || !actions) return;
    let cancelled = false;
    void (async () => {
      const [operation, stashes, tags, remotes] = await Promise.all([
        orElse(() => gitOperationState(cwd), null),
        orElse(() => gitStashList(cwd), []),
        orElse(() => gitTags(cwd), []),
        orElse(() => gitRemotes(cwd), []),
      ]);
      if (cancelled) return;
      setData({
        operation,
        stashCount: stashes.length,
        tagCount: tags.length,
        remoteCount: remotes.length,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, actions, cwd]);

  const branch = index?.branch ?? null;
  const items = useMemo(() => {
    const files = index?.files ?? [];
    const others = (branches?.branches ?? []).filter((item) => !item.current);
    return gitActionsMenuItems({
      actions,
      updateNotice: supported === false ? HOST_UPDATE_NOTICE : null,
      busy: busy !== null,
      branch,
      hasCommits: Boolean(index?.head),
      hasRemote: Boolean(index?.remote),
      hasUpstream: Boolean(index?.upstream),
      ahead: index?.ahead ?? 0,
      stagedCount: files.filter((file) => file.staged).length,
      unstagedCount: files.filter((file) => file.unstaged).length,
      changedCount: files.length,
      otherBranchCount: others.length,
      otherLocalBranchCount: others.filter((item) => !item.remote).length,
      autoFetch,
      ...data,
    });
  }, [actions, autoFetch, branch, branches, busy, data, index, supported]);

  const run = async (work: () => Promise<unknown>, status?: string, pending?: string) => {
    if (gitPanelRuntime(cwd).state.busy) return;
    setGitFeedback(cwd, null);
    setBusy(GIT_MENU_BUSY);
    onPending?.(pending ?? null);
    try {
      await work();
      if (status) onStatus(status);
      if (status)
        setGitFeedback(cwd, {
          kind: "success",
          title: status,
        });
    } catch (error) {
      setGitFeedback(cwd, {
        kind: "error",
        get title() {
          return t("Git operation failed");
        },
        detail: errorText(error),
      });
    } finally {
      onPending?.(null);
      setBusy(null);
      onMutated();
    }
  };

  /** Load a list for a pick dialog, then show it. */
  const choose = async (
    load: () => Promise<PickItem[]>,
    dialog: Omit<Extract<Dialog, { kind: "pick" }>, "kind" | "items">,
  ) => {
    try {
      const items = await withGitOperation(cwd, "Loading Git options…", load);
      setDialog({ kind: "pick", items, ...dialog });
    } catch (error) {
      setGitFeedback(cwd, {
        kind: "error",
        get title() {
          return t("Couldn’t load Git options");
        },
        detail: errorText(error),
        retry: async () => choose(load, dialog),
      });
    }
  };

  const askName = (
    spec: Omit<Extract<Dialog, { kind: "name" }>, "kind" | "onSubmit">,
    submit: (name: string, extra: string) => Promise<unknown>,
    status?: string,
  ) =>
    setDialog({
      kind: "name",
      ...spec,
      onSubmit: (name, extra) => {
        setDialog(null);
        void run(() => submit(name, extra), status);
      },
    });

  /** Branches to pick from; `localOnly` and `skipCurrent` narrow the list. */
  const branchItems = async (localOnly: boolean, skipCurrent: boolean) => {
    const listed = await gitBranches(cwd);
    return listed.branches
      .filter((item) => !(localOnly && item.remote) && !(skipCurrent && item.current))
      .map((item): PickItem => {
        const ref = item.remote ? `${item.remote}/${item.name}` : item.name;
        return {
          id: ref,
          label: ref,
          detail: item.remote ? "remote" : undefined,
        };
      });
  };

  const stashItems = async () => {
    const entries = await gitStashList(cwd);
    return {
      entries,
      items: entries.map((entry): PickItem => ({
        id: String(entry.index),
        label: entry.message,
        detail: `stash@{${entry.index}}`,
      })),
    };
  };

  const pickStash = async (
    title: string,
    onEntry: (entry: GitStashEntry, count: number) => void,
  ) => {
    let entries: GitStashEntry[] = [];
    await choose(
      async () => {
        const listed = await stashItems();
        entries = listed.entries;
        return listed.items;
      },
      {
        title,
        get placeholder() {
          return t("Filter stashes");
        },
        get emptyText() {
          return t("No stashes");
        },
        onPick: (id) => {
          setDialog(null);
          const entry = entries.find((candidate) => String(candidate.index) === id);
          if (entry) onEntry(entry, entries.length);
        },
      },
    );
  };

  const stashWith = (mode: GitStashMode) =>
    run(() => gitStash(cwd, undefined, mode), "Changes stashed");

  const undoLastCommit = async () => {
    if (
      index?.headPushed &&
      !(await confirm(
        "The last commit is already pushed. Undo it here anyway? Pushing the result later needs a force push from the terminal.",
        "Undo Commit",
      ))
    ) {
      return;
    }
    await run(() => gitUndoLastCommit(cwd), "Last commit undone");
  };

  const abortOperation = async () => {
    if (!data.operation) return;
    const label = operationLabel(data.operation).toLowerCase();
    if (
      !(await confirm(
        `Abort the ${label}? Changes made while resolving it are discarded.`,
        "Abort",
      ))
    ) {
      return;
    }
    await run(() => gitOperationAbort(cwd));
  };

  const handle = async (id: string) => {
    if (commitMenuOptions(id) || id === "stage-all" || id === "unstage-all" || id === "discard-all")
      onRevealChanges?.();
    const commit = commitMenuOptions(id);
    if (commit) return void changes.current?.commit(commit);
    switch (id) {
      case "pull":
        return run(() => gitPull(cwd), undefined, "Pulling…");
      case "pull-rebase":
        return run(() => gitPull(cwd, true), undefined, "Pulling…");
      case "push":
      case "branch-publish":
        return run(() => gitPush(cwd), undefined, "Pushing…");
      case "sync":
        return run(() => gitSync(cwd), undefined, "Syncing…");
      case "fetch":
        return run(() => gitFetch(cwd), undefined, "Fetching…");
      case "fetch-prune":
        return run(() => gitFetch(cwd, true), undefined, "Fetching…");
      case "auto-fetch":
        return onToggleAutoFetch();
      case "checkout":
        return setDialog({ kind: "branches" });
      case "undo-commit":
        return undoLastCommit();
      case "abort-operation":
        return abortOperation();
      case "stage-all":
        return void changes.current?.runAll("stage");
      case "unstage-all":
        return void changes.current?.runAll("unstage");
      case "discard-all":
        return void changes.current?.runAll("discard");
      case "branch-merge":
        return choose(() => branchItems(false, true), {
          get title() {
            return t("Merge Branch");
          },
          description: branch ? `Merge into ${branch}` : undefined,
          get placeholder() {
            return t("Filter branches");
          },
          get emptyText() {
            return t("No other branches");
          },
          onPick: (ref) => {
            setDialog(null);
            void run(() => gitMerge(cwd, ref));
          },
        });
      case "branch-rebase":
        return choose(() => branchItems(false, true), {
          get title() {
            return t("Rebase Branch");
          },
          description: branch ? `Rebase ${branch} onto` : undefined,
          get placeholder() {
            return t("Filter branches");
          },
          get emptyText() {
            return t("No other branches");
          },
          onPick: (ref) => {
            setDialog(null);
            void run(() => gitRebase(cwd, ref));
          },
        });
      case "branch-create":
        return askName(
          {
            get title() {
              return t("Create Branch");
            },
            get description() {
              return t("Create a branch at HEAD and switch to it.");
            },
            get label() {
              return t("Branch name");
            },
            get placeholder() {
              return t("feature/my-branch");
            },
            submitLabel: "Create Branch",
          },
          (name) => gitCreateBranch(cwd, name),
        );
      case "branch-create-from":
        return choose(() => branchItems(false, false), {
          get title() {
            return t("Create Branch From");
          },
          get placeholder() {
            return t("Filter branches");
          },
          get emptyText() {
            return t("No branches");
          },
          onPick: (ref) =>
            askName(
              {
                get title() {
                  return t("Create Branch");
                },
                get description() {
                  return t("Create a branch from {p0} and switch to it.", { p0: ref });
                },
                get label() {
                  return t("Branch name");
                },
                get placeholder() {
                  return t("feature/my-branch");
                },
                submitLabel: "Create Branch",
              },
              (name) => gitCreateBranchFrom(cwd, name, ref),
            ),
        });
      case "branch-rename":
        if (!branch) return;
        return askName(
          {
            get title() {
              return t("Rename Branch");
            },
            get description() {
              return t("Rename {p0}.", { p0: branch });
            },
            get label() {
              return t("New name");
            },
            get placeholder() {
              return t("feature/my-branch");
            },
            submitLabel: "Rename",
            initialValue: branch,
          },
          (name) => gitRenameBranch(cwd, branch, name),
        );
      case "branch-delete":
        return choose(() => branchItems(true, true), {
          get title() {
            return t("Delete Branch");
          },
          get placeholder() {
            return t("Filter branches");
          },
          get emptyText() {
            return t("No other local branches");
          },
          onPick: (name) => {
            setDialog(null);
            void run(() => deleteLocalBranch(cwd, name));
          },
        });
      case "remote-add":
        return askName(
          {
            get title() {
              return t("Add Remote");
            },
            get description() {
              return t("Add a named remote to this repository.");
            },
            get label() {
              return t("Remote name");
            },
            get placeholder() {
              return t("origin");
            },
            submitLabel: "Add Remote",
            extra: {
              get label() {
                return t("Remote URL");
              },
              placeholder: "https://github.com/owner/repo.git",
            },
          },
          (name, url) => gitRemoteAdd(cwd, name, url),
        );
      case "remote-remove":
        return choose(
          async () =>
            (await gitRemotes(cwd)).map((remote): PickItem => ({
              id: remote.name,
              label: remote.name,
              detail: remote.url,
            })),
          {
            get title() {
              return t("Remove Remote");
            },
            get placeholder() {
              return t("Filter remotes");
            },
            get emptyText() {
              return t("No remotes");
            },
            onPick: (name) => {
              setDialog(null);
              void (async () => {
                const confirmed = await confirm(
                  `Remove remote ${name}? Its remote-tracking branches are deleted from this repository. Nothing changes on the server.`,
                  "Remove",
                );
                if (confirmed) await run(() => gitRemoteRemove(cwd, name));
              })();
            },
          },
        );
      case "stash":
        return stashWith("tracked");
      case "stash-untracked":
        return stashWith("untracked");
      case "stash-staged":
        return stashWith("staged");
      case "stash-apply-latest":
        return run(() => gitStashAction(cwd, "apply", 0));
      case "stash-pop-latest":
        return run(() => gitStashAction(cwd, "pop", 0));
      case "stash-apply":
        return pickStash(
          "Apply Stash",
          (entry) => void run(() => gitStashAction(cwd, "apply", entry.index)),
        );
      case "stash-pop":
        return pickStash(
          "Pop Stash",
          (entry) => void run(() => gitStashAction(cwd, "pop", entry.index)),
        );
      case "stash-drop":
        return pickStash(
          "Drop Stash",
          (entry) =>
            void (async () => {
              const confirmed = await confirm(
                `Drop "${entry.message}"? The stashed changes are lost.`,
                "Drop",
              );
              if (confirmed) await run(() => gitStashAction(cwd, "drop", entry.index));
            })(),
        );
      case "stash-drop-all": {
        const count = data.stashCount;
        const confirmed = await confirm(
          `Drop all ${count} stash${count === 1 ? "" : "es"}? The stashed changes are lost.`,
          "Drop All",
        );
        if (confirmed) await run(() => gitStashClear(cwd));
        return;
      }
      case "stash-view":
        return pickStash("View Stash", (entry) => onOpenCommit(stashCommit(entry)));
      case "tag-create": {
        const head = index?.head;
        if (!head) return;
        return askName(
          {
            get title() {
              return t("Create Tag");
            },
            get description() {
              return t("Tag the commit at HEAD.");
            },
            get label() {
              return t("Tag name");
            },
            placeholder: "v1.0.0",
            submitLabel: "Create Tag",
          },
          (name) => gitCreateTag(cwd, name, head),
        );
      }
      case "tag-delete":
        return choose(
          async () =>
            (await gitTags(cwd)).map((name): PickItem => ({
              id: name,
              label: name,
            })),
          {
            get title() {
              return t("Delete Tag");
            },
            get placeholder() {
              return t("Filter tags");
            },
            get emptyText() {
              return t("No tags");
            },
            onPick: (name) => {
              setDialog(null);
              void (async () => {
                const confirmed = await confirm(
                  `Delete tag ${name}? A copy already pushed to a remote stays there.`,
                  "Delete",
                );
                if (confirmed) await run(() => gitDeleteTag(cwd, name));
              })();
            },
          },
        );
    }
  };

  return (
    <>
      {toolbar
        ? [
            { id: "fetch", label: t("Fetch"), icon: ArrowDownCircle },
            { id: "sync", label: t("Sync Changes"), icon: RefreshCw },
            { id: "push", label: t("Push"), icon: CloudUpload },
            { id: "stage-all", label: t("Stage All Changes"), icon: Plus },
            { id: "commit", label: t("Commit"), icon: Check },
          ].map(({ id, label, icon: Icon }) => {
            const item = items
              .flatMap((item) => (item.kind === "item" ? [item, ...(item.submenu ?? [])] : []))
              .find((item) => item.kind === "item" && item.id === id);
            return (
              <Button
                key={id}
                variant="ghost"
                size="sm"
                iconOnly
                label={label}
                title={label}
                aria-label={label}
                disabled={!item || item.kind !== "item" || !!item.disabled || !!busy}
                onClick={() => void handle(id)}
              >
                <Icon className="size-3.5" />
              </Button>
            );
          })
        : null}
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        label={t("Branch actions")}
        aria-haspopup="menu"
        aria-label={t("Branch actions")}
        aria-expanded={open}
        disabled={busy !== null}
        onClick={(event) => {
          const button = event.currentTarget;
          setAnchor((current) => (current ? null : button));
        }}
      >
        {busy === GIT_MENU_BUSY ? (
          <Loader className="size-3.5 animate-spin" strokeWidth={1.75} />
        ) : (
          <MoreHorizontal className="size-4" strokeWidth={2} />
        )}
      </Button>
      {anchor ? (
        <ExplorerMenu
          anchor={anchor}
          items={items}
          ariaLabel="Branch actions"
          width={232}
          onPick={(id) => {
            setAnchor(null);
            void handle(id);
          }}
          onClose={() => setAnchor(null)}
        />
      ) : null}
      {dialog?.kind === "branches" ? (
        <BranchManagerDialog cwd={cwd} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "pick" ? (
        <GitPickDialog
          key={dialog.title}
          title={dialog.title}
          description={dialog.description}
          placeholder={dialog.placeholder}
          emptyText={dialog.emptyText}
          items={dialog.items}
          onPick={dialog.onPick}
          onCancel={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "name" ? (
        <RefNameDialog
          key={dialog.title}
          title={dialog.title}
          description={dialog.description}
          label={dialog.label}
          placeholder={dialog.placeholder}
          submitLabel={dialog.submitLabel}
          initialValue={dialog.initialValue}
          extra={dialog.extra}
          busy={false}
          onSubmit={dialog.onSubmit}
          onCancel={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
