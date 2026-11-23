import { errorText } from "../../../shared/lib/errors";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { useEffect, useState } from "react";
import { gitDiffIndex } from "../../../platform/tauri/fs";
import { basename } from "../../../platform/tauri/fs";
import { Popover, popupListClassName, type PopoverAnchor } from "../../../shared/ui/Popover";
import { applyProjectDiffStats } from "../../source-control/public/useProjectDiffStats";
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

/** One project's detail; `null` when `isCancelled` turned true while the index was read. */
async function loadDetail(path: string, isCancelled: () => boolean): Promise<Detail | null> {
  try {
    const index = await gitDiffIndex(path);
    if (isCancelled()) return null;
    applyProjectDiffStats(path, {
      files: index.files.length + (index.conflicts?.length ?? 0),
      additions: index.additions,
      deletions: index.deletions,
    });
    return {
      state: "ready",
      branch: index.branch,
      files: index.files.length + (index.conflicts?.length ?? 0),
      ahead: index.ahead,
      behind: index.behind,
      hasUpstream: index.upstream != null,
    };
  } catch (error) {
    return { state: "error", message: errorText(error) };
  }
}

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
  const t = useT();
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const key = paths.join("\0");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const path of key ? key.split("\0") : []) {
        if (cancelled) return;
        if (!isLocalProject(path)) continue;
        const detail = await loadDetail(path, () => cancelled);
        if (!detail || cancelled) return;
        setDetails((current) => ({ ...current, [path]: detail }));
      }
    })();
    return () => {
      cancelled = true;
    };
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
      kind="dialog"
      aria-label={t("{p0} git overview", { p0: name })}
      onDismiss={onDismiss}
      className={popupListClassName}
    >
      <Text as="p" size="caption" tone="muted" className="px-2.5 pb-1 pt-1.5">
        {t("{p0} of {p1} local projects loaded · {p2} with uncommitted changes", {
          p0: summary.known,
          p1: summary.local,
          p2: summary.dirty,
        })}
        {summary.syncKnown > 0 ? ` · ↑${summary.ahead} ↓${summary.behind}` : ""}
      </Text>
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
                tooltip={path}
                onClick={() => onSelect(path)}
                className="flex w-full flex-wrap items-center gap-2 text-left"
              >
                <Text size="inherit" tone="inherit" wrap="anywhere" className="min-w-0 flex-1">
                  {basename(path)}
                </Text>
                {!local ? (
                  <Text size="micro" tone="muted" className="shrink-0">
                    {t("remote")}
                  </Text>
                ) : !detail || detail.state === "loading" ? (
                  <Text size="micro" tone="muted" className="shrink-0">
                    …
                  </Text>
                ) : detail.state === "error" ? (
                  <Text size="micro" tone="danger" className="shrink-0">
                    {t("no git info")}
                  </Text>
                ) : (
                  <Text
                    size="micro"
                    tone="muted"
                    className="flex min-w-0 flex-wrap items-center gap-2 tabular-nums"
                  >
                    <Text size="inherit" tone="inherit" wrap="anywhere" className="min-w-0">
                      {detail.branch ?? t("detached")}
                    </Text>
                    <Tooltip
                      label={t(detail.files === 1 ? "{p0} changed file" : "{p0} changed files", {
                        p0: detail.files,
                      })}
                      asChild
                    >
                      <Text size="inherit" tone={detail.files > 0 ? "warning" : "inherit"}>
                        {detail.files}
                      </Text>
                    </Tooltip>
                    <Tooltip label={t("Ahead / behind upstream")} asChild>
                      <span>
                        {detail.hasUpstream
                          ? `↑${detail.ahead} ↓${detail.behind}`
                          : t("no upstream")}
                      </span>
                    </Tooltip>
                  </Text>
                )}
              </Button>
              {detail?.state === "error" ? (
                <Disclosure summary={t("Details")} size="sm" textSize="micro" className="px-2.5">
                  <Text size="micro" tone="danger" wrap="anywhere">
                    {detail.message}
                  </Text>
                </Disclosure>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Popover>
  );
}
