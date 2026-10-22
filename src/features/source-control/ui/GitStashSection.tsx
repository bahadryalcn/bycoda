import { Button } from "../../../shared/ui/Button";
import { errorText } from "../../../shared/lib/errors";
import { t, useLocale } from "../../../shared/i18n/git";
import { useCallback, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  RefreshCw,
  MoreHorizontal,
} from "../../../shared/ui/icons";
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
import { useGitPanelState, withGitOperation, setGitFeedback } from "../model/gitPanelState";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { appName } from "../../../shared/lib/appName";

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
  const [busy] = useGitPanelState(cwd, "busy");
  const read = useCallback(() => gitStashList(cwd), [cwd]);
  const { data, loading, error, refresh } = useGitResource(cwd, `stashes:${cwd}`, active, read);
  const entries = data ?? [];
  const [menu, setMenu] = useState<{ entry: GitStashEntry; anchor: HTMLElement } | null>(null);

  if (!active) return null;

  const run = async (work: () => Promise<unknown>) => {
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
      notifyGitChanged(cwd, "refs");
    }
  };

  const drop = async (entry: GitStashEntry) => {
    const confirmed = await ask(`Drop "${entry.message}"? The stashed changes are lost.`, {
      title: appName(),
      kind: "warning",
      okLabel: "Drop",
    });
    if (confirmed) await run(() => gitStashAction(cwd, "drop", entry.index, entry.sha));
  };

  return (
    <div className="shrink-0 border-t border-stroke">
      <div className="flex h-7 items-center gap-1 px-1.5">
        <Button
          variant="ghost"
          motion="none"
          type="button"
          aria-expanded={open}
          onClick={() => {
            stashOpen = !open;
            setOpen(stashOpen);
          }}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
        >
          {open ? (
            <ChevronDown
              className="size-3.5 shrink-0 text-[var(--ui-text-secondary)]"
              strokeWidth={1.75}
            />
          ) : (
            <ChevronRight
              className="size-3.5 shrink-0 text-[var(--ui-text-secondary)]"
              strokeWidth={1.75}
            />
          )}
          <span className="min-w-0 truncate text-xs font-medium text-[var(--ui-text-secondary)]">
            {t("Stashes")}
          </span>
          <span className="text-(length:--ui-font-caption) tabular-nums text-(--ui-text-secondary)">
            {entries.length}
          </span>
        </Button>
        <Button
          iconOnly
          label={t("Refresh stashes")}
          variant="ghost"
          motion="none"
          type="button"
          title={t("Refresh stashes")}
          aria-label={t("Refresh stashes")}
          aria-busy={loading}
          disabled={loading}
          onClick={refresh}
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={1.75} />
        </Button>
        <Button
          iconOnly
          label={t("Stash all changes")}
          variant="ghost"
          motion="none"
          type="button"
          title={t("Stash all changes, including untracked files")}
          aria-label={t("Stash all changes")}
          disabled={!!busy || !hasChanges}
          onClick={() => void run(() => gitStash(cwd))}
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
        </Button>
      </div>
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
          <p className="px-3 pb-2 text-[12px] text-(--ui-text-secondary)">{t("No stashes")}</p>
        ) : (
          <ul className="max-h-[min(10rem,20vh)] overflow-y-auto pb-1">
            {entries.map((entry) => (
              <li key={entry.sha} className="flex items-center gap-0.5 px-3 py-0.5">
                <Button
                  variant="item"
                  motion="none"
                  type="button"
                  title={entry.message}
                  onClick={() => onOpenCommit(stashCommit(entry))}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="min-w-0 truncate">{entry.message}</span>
                </Button>
                <Button
                  variant="ghost"
                  motion="none"
                  iconOnly
                  label={t("Actions for {p0}", { p0: entry.message })}
                  disabled={!!busy}
                  aria-haspopup="menu"
                  aria-expanded={menu?.entry.sha === entry.sha}
                  onClick={(event) => setMenu({ entry, anchor: event.currentTarget })}
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
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
              void run(() => gitStashAction(cwd, id, entry.index, entry.sha));
          }}
        />
      ) : null}
    </div>
  );
}
