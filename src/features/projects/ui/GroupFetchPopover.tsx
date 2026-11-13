import { Disclosure } from "../../../shared/ui/Disclosure";
import { Text } from "../../../shared/ui/Text";
import { Progress } from "../../../shared/ui/Progress";
import { useT } from "../../../shared/i18n";
import { useEffect, useState } from "react";
import { basename, gitFetch, gitRemotes, notifyGitChanged } from "../../../platform/tauri/fs";
import { Popover } from "../../../shared/ui/Popover";
import { GIT_ACTIONS, requireRemoteSupport } from "../../connections/public/remoteCapabilities";
import { fetchAllProjects, type FetchAllResult } from "../model/groupGit";

const LABELS: Record<FetchAllResult["status"], string> = {
  fetched: "Fetched",
  "no-remote": "No remote",
  failed: "Failed",
};

/** Runs `git fetch` for the group's projects, one at a time. A project on another
 * machine needs a host that supports it. */
export function GroupFetchPopover({
  x,
  y,
  name,
  paths,
  onClose,
}: {
  x: number;
  y: number;
  name: string;
  paths: readonly string[];
  onClose: () => void;
}) {
  const t = useT();
  const [results, setResults] = useState<readonly FetchAllResult[]>([]);
  const [current, setCurrent] = useState(0);
  const [done, setDone] = useState(false);
  // Runs once per open; the list is fixed when the popover is created.
  const [fetchPaths] = useState(paths);

  useEffect(() => {
    let cancelled = false;
    void fetchAllProjects(
      fetchPaths,
      {
        hasRemote: async (path) => {
          await requireRemoteSupport(path, GIT_ACTIONS);
          return (await gitRemotes(path)).length > 0;
        },
        fetch: (path) => gitFetch(path),
      },
      (next, index) => {
        if (cancelled) return;
        setResults([...next]);
        setCurrent(index);
      },
      () => cancelled,
    ).then(() => {
      if (cancelled) return;
      setDone(true);
      notifyGitChanged();
    });
    return () => {
      cancelled = true;
    };
  }, [fetchPaths]);

  return (
    <Popover
      anchor={{ x, y }}
      gap={0}
      width={320}
      role="dialog"
      aria-label={t("Fetch all in {p0}", { p0: name })}
      aria-live="polite"
      onDismiss={onClose}
      className="overflow-y-auto p-1"
    >
      <Text as="p" size="caption" tone="muted" className="px-2.5 pb-1 pt-1.5">
        {paths.length === 0
          ? t("No projects to fetch")
          : done
            ? t("Fetched {p0} of {p1}", {
                p0: results.filter((r) => r.status === "fetched").length,
                p1: paths.length,
              })
            : t("Fetching {p0} of {p1}…", {
                p0: Math.min(current + 1, paths.length),
                p1: paths.length,
              })}
      </Text>
      {paths.length ? (
        <Progress
          compact
          label={t("Fetch all in {p0}", { p0: name })}
          value={done ? paths.length : results.length}
          max={paths.length}
        />
      ) : null}
      <ul>
        {paths.map((path, index) => {
          const result = results[index];
          return (
            <Text
              as="li"
              size="secondary"
              tone="primary"
              key={path}
              className="flex min-w-0 flex-col gap-1 px-2.5 py-1"
            >
              <Text size="inherit" tone="inherit" wrap="anywhere">
                {basename(path)}
              </Text>
              <Text size="micro" tone="muted" wrap="anywhere">
                {path}
              </Text>
              <Text
                size="micro"
                tone={
                  result?.status === "failed"
                    ? "danger"
                    : result?.status === "fetched"
                      ? "success"
                      : "muted"
                }
                className="shrink-0"
              >
                {result
                  ? t(LABELS[result.status])
                  : index === current && !done
                    ? t("Fetching…")
                    : t("Waiting")}
              </Text>
              {result?.error ? (
                <Disclosure summary={t("Details")} size="sm" textSize="micro">
                  <Text size="micro" tone="danger" wrap="anywhere">
                    {result.error}
                  </Text>
                </Disclosure>
              ) : null}
            </Text>
          );
        })}
      </ul>
    </Popover>
  );
}
