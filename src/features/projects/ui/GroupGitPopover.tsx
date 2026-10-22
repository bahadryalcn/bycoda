import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState } from "react";
import { gitDiffIndex } from "../../../platform/tauri/fs";
import { basename } from "../../../platform/tauri/fs";
import { Popover, type PopoverAnchor } from "../../../shared/ui/Popover";
import { applyProjectDiffStats } from "../../source-control/hooks/useProjectDiffStats";
import { summarizeGroupGit } from "../model/groupGit";
import { isLocalProject } from "../model/recents";

type Detail =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ready";
      branch: string | null;
      files: number;
      ahead: number;
      behind: number;
      hasUpstream: boolean;
    };

/**
 * Per-project branch, changed files and ahead/behind for a group. The sync
 * numbers need a full git index per project, so they are read only while this
 * popover is open, one project at a time.
 */
export function GroupGitPopover({
  anchor,
  name,
  paths,
  onSelect,
  onDismiss,
}: {
  anchor: PopoverAnchor;
  name: string;
  paths: readonly string[];
  onSelect: (path: string) => void;
  onDismiss: () => void;
}) {
  useLocale();
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const key = paths.join("\0");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const path of paths) {
        if (cancelled) return;
        if (!isLocalProject(path)) continue;
        let detail: Detail;
        try {
          const index = await gitDiffIndex(path);
          if (cancelled) return;
          applyProjectDiffStats(path, {
            files: index.files.length + (index.conflicts?.length ?? 0),
            additions: index.additions,
            deletions: index.deletions,
          });
          detail = {
            state: "ready",
            branch: index.branch,
            files: index.files.length + (index.conflicts?.length ?? 0),
            ahead: index.ahead,
            behind: index.behind,
            hasUpstream: index.upstream != null,
          };
        } catch (error) {
          detail = {
            state: "error",
            message: error instanceof Error ? error.message : String(error),
          };
        }
        if (cancelled) return;
        setDetails((current) => ({ ...current, [path]: detail }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // `key` stands in for `paths`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const summary = summarizeGroupGit(
    paths.map((path) => {
      const detail = details[path];
      const ready = detail?.state === "ready" ? detail : null;
      return {
        remote: !isLocalProject(path),
        files: ready ? ready.files : null,
        ahead: ready?.hasUpstream ? ready.ahead : null,
        behind: ready?.hasUpstream ? ready.behind : null,
      };
    }),
  );

  return (
    <Popover
      anchor={anchor}
      align="start"
      width={320}
      role="dialog"
      aria-label={t("{p0} git overview", { p0: name })}
      onDismiss={onDismiss}
      className="overflow-y-auto p-1"
    >
      <p className="px-2.5 pb-1 pt-1.5 text-xs text-[var(--ui-text-muted)]">
        {summary.known}
        {t(" of ")}
        {summary.local}
        {t(" local projects loaded ·")} {summary.dirty}{" "}
        {summary.dirty === 1 ? t("project has") : t("projects have")} {t("uncommitted changes")}
        {summary.syncKnown > 0 ? ` · ↑${summary.ahead} ↓${summary.behind}` : ""}
      </p>
      <ul>
        {paths.map((path) => {
          const local = isLocalProject(path);
          const detail = details[path];
          return (
            <li key={path}>
              <Button
                variant="item"
                motion="none"
                type="button"
                title={t("Open this project's Changes tab")}
                onClick={() => onSelect(path)}
                className="flex w-full items-center gap-2 text-left"
              >
                <span className="min-w-0 flex-1 truncate">{basename(path)}</span>
                {!local ? (
                  <span className="shrink-0 text-[11px] text-[var(--ui-text-muted)]">
                    {t("remote")}
                  </span>
                ) : !detail || detail.state === "loading" ? (
                  <span className="shrink-0 text-[11px] text-[var(--ui-text-muted)]">…</span>
                ) : detail.state === "error" ? (
                  <span
                    className="shrink-0 text-[11px] text-[var(--ui-text-muted)]"
                    title={detail.message}
                  >
                    {t("no git info")}
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-[var(--ui-text-muted)]">
                    <span className="max-w-[110px] truncate">{detail.branch ?? t("detached")}</span>
                    <span
                      className={detail.files > 0 ? "text-warning" : undefined}
                      title={t(detail.files === 1 ? "{p0} changed file" : "{p0} changed files", {
                        p0: detail.files,
                      })}
                    >
                      {detail.files}
                    </span>
                    <span title={t("Ahead / behind upstream")}>
                      {detail.hasUpstream ? `↑${detail.ahead} ↓${detail.behind}` : t("no upstream")}
                    </span>
                  </span>
                )}
              </Button>
            </li>
          );
        })}
      </ul>
    </Popover>
  );
}
