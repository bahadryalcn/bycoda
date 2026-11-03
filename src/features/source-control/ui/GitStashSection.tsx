import { ActionHost, InlineMoreAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { errorText } from "../../../shared/lib/errors";
import { t, useLocale } from "../../../shared/i18n/git";
import { useCallback, useState } from "react";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { Plus, RefreshCw } from "../../../shared/ui/icons";
import {
  gitStash,
  gitStashAction,
  gitStashList,
  notifyGitChanged,
  type GitHistoryCommit,
  type GitStashEntry,
} from "../../../platform/tauri/fs";
import { GIT_ACTIONS, useRemoteSupports } from "../../connections/model/remoteCapabilities";
import { useGitResource } from "../hooks/useGitResource";
import { GitFeedback } from "./GitFeedback";
import {
  gitPanelRuntime,
  useGitPanelState,
  withGitOperation,
  setGitFeedback,
} from "../model/gitPanelState";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";

type Props = {
  cwd: string;
  enabled: boolean;
  hasChanges: boolean;
  onOpenCommit: (commit: GitHistoryCommit, pin?: boolean) => void;
};

let stashOpen = false;

/** A stash is a commit, so the commit diff view can show what it holds. */
export function stashCommit(entry: GitStashEntry): GitHistoryCommit {
  return {
    sha: entry.sha,
    shortSha: entry.sha.slice(0, 7),
    parents: [],
    author: "",
    timestamp: entry.timestamp,
    subject: entry.message,
    refs: [],
    head: false,
  };
}

/** Lists the repository's stashes. On another machine, needs a host with `git.actions`. */
export function GitStashSection({ cwd, enabled, hasChanges, onOpenCommit }: Props) {
  useLocale();
  const supported = useRemoteSupports(cwd, GIT_ACTIONS) === true;
  const active = enabled && !!cwd && cwd !== "~" && supported;
  const [open, setOpen] = useState(stashOpen);
  const { confirm, dialog: confirmElement } = useConfirm();
  const [busy] = useGitPanelState(cwd, "busy");
  const [stashAction, setStashAction] = useGitPanelState(cwd, "stashAction");
  const read = useCallback(() => gitStashList(cwd), [cwd]);
  const { data, loading, error, refresh } = useGitResource(cwd, `stashes:${cwd}`, active, read);
  const entries = data ?? [];
  const [menu, setMenu] = useState<{ entry: GitStashEntry; anchor: HTMLElement } | null>(null);

  if (!active) return null;

  const run = async (target: "create" | `entry:${string}`, work: () => Promise<unknown>) => {
    if (gitPanelRuntime(cwd).state.busy) return;
    setStashAction(target);
    try {
      await withGitOperation(cwd, "Updating stash…", work);
      setGitFeedback(cwd, {
        kind: "success",
        get title() {
          return t("Stash operation complete");
        },
      });
    } catch (error) {
      setGitFeedback(cwd, {
        kind: "error",
        get title() {
          return t("Couldn’t update stash");
        },
        detail: errorText(error),
      });
    } finally {
      setStashAction(null);
      notifyGitChanged(cwd, "refs");
    }
  };

  const drop = async (entry: GitStashEntry) => {
    const confirmed = await confirm({
      title: t("Drop"),
      message: t('Drop "{p0}"? The stashed changes are lost.', { p0: entry.message }),
      confirmLabel: t("Drop"),
    });
    if (confirmed)
      await run(`entry:${entry.sha}`, () => gitStashAction(cwd, "drop", entry.index, entry.sha));
  };

  return (
    <div className="shrink-0 border-t border-(--ui-pane-border)">
      {confirmElement}
      <SectionLabel
        className="px-1"
        collapsible
        expanded={open}
        count={entries.length}
        onExpandedChange={() => {
          stashOpen = !open;
          setOpen(stashOpen);
        }}
        actions={
          <>
            <Button
              iconOnly
              size="sm"
              label={t("Refresh stashes")}
              variant="ghost"
              motion="none"
              type="button"
              loading={loading}
              loadingLabel={t("Refreshing…")}
              onClick={refresh}
            >
              <RefreshCw className="icon-sm" strokeWidth={1.75} />
            </Button>
            <Button
              iconOnly
              size="sm"
              label={t("Stash all changes")}
              tooltip={t("Stash all changes, including untracked files")}
              variant="ghost"
              motion="none"
              type="button"
              disabled={stashAction !== "create" && (!!busy || !hasChanges)}
              loading={stashAction === "create"}
              loadingLabel={t("Working…")}
              onClick={() => void run("create", () => gitStash(cwd))}
            >
              <Plus className="icon-sm" strokeWidth={1.75} />
            </Button>
          </>
        }
      >
        {t("Stashes")}
      </SectionLabel>
      {error ? (
        <GitFeedback
          title={t("Couldn’t load stashes")}
          detail={error}
          stale={data !== null}
          onRetry={refresh}
        />
      ) : null}
      {open ? (
        entries.length === 0 && !loading && !error ? (
          <EmptyState
            size="inline"
            kind="empty"
            className="px-3 pt-0"
            description={t("No stashes")}
          />
        ) : (
          <ul className="max-h-[min(10rem,20vh)] overflow-y-auto pb-1">
            {entries.map((entry) => (
              <li key={entry.sha}>
                <ActionHost className="mx-1 min-h-(--ui-control-height-compact) pe-1">
                  <Button
                    variant="item"
                    size="sm"
                    motion="none"
                    type="button"
                    tooltip={entry.message}
                    tooltipWhen="overflow"
                    onClick={() => onOpenCommit(stashCommit(entry))}
                    className="min-w-0 flex-1 justify-start"
                  >
                    <span className="min-w-0 truncate">{entry.message}</span>
                  </Button>
                  <InlineMoreAction
                    label={t("Actions for {p0}", { p0: entry.message })}
                    disabled={!!busy && stashAction !== `entry:${entry.sha}`}
                    loading={stashAction === `entry:${entry.sha}`}
                    loadingLabel={t("Working…")}
                    expanded={menu?.entry.sha === entry.sha}
                    onOpen={(anchor) => setMenu({ entry, anchor })}
                  />
                </ActionHost>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {menu ? (
        <DropdownMenu
          anchor={menu.anchor}
          label={t("Stashes")}
          onClose={() => setMenu(null)}
          items={[
            {
              kind: "item",
              id: "apply",
              label: t("Apply"),
              description: t("Apply and keep the stash"),
              disabled: !!busy,
            },
            {
              kind: "item",
              id: "pop",
              label: t("Pop"),
              description: t("Apply and remove the stash"),
              disabled: !!busy,
            },
            { kind: "sep" },
            { kind: "item", id: "drop", label: t("Drop"), danger: true, disabled: !!busy },
          ]}
          onPick={(id) => {
            const entry = menu.entry;
            setMenu(null);
            if (busy) return;
            if (id === "drop") void drop(entry);
            else if (id === "apply" || id === "pop")
              void run(`entry:${entry.sha}`, () => gitStashAction(cwd, id, entry.index, entry.sha));
          }}
        />
      ) : null}
    </div>
  );
}
