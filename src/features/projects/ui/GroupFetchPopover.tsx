import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { LiveText } from "../../../shared/ui/LiveText";
import { Text } from "../../../shared/ui/Text";
import { Progress } from "../../../shared/ui/Progress";
import { useT } from "../../../shared/i18n";
import { useEffect, useState } from "react";
import { basename, gitFetch, gitRemotes, notifyGitChanged } from "../../../platform/tauri/fs";
import { Popover, popupListClassName } from "../../../shared/ui/Popover";
import { GIT_ACTIONS, requireRemoteSupport } from "../../connections/public/remoteCapabilities";
import { fetchAllProjects, type FetchAllResult } from "../model/groupGit";

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
  const labels: Record<FetchAllResult["status"], string> = {
    fetched: t("Fetched"),
    "no-remote": t("No remote"),
    failed: t("Failed"),
  };
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
      kind="dialog"
      aria-label={t("Fetch all in {p0}", { p0: name })}
      onDismiss={onClose}
      className={popupListClassName}
    >
      <LiveText
        size="caption"
        tone="muted"
        className="block px-2.5 pb-1 pt-1.5"
        text={
          paths.length === 0
            ? t("No projects to fetch")
            : done
              ? t("Fetched {p0} of {p1}", {
                  p0: results.filter((r) => r.status === "fetched").length,
                  p1: paths.length,
                })
              : t("Fetching {p0} of {p1}…", {
                  p0: Math.min(current + 1, paths.length),
                  p1: paths.length,
                })
        }
      />
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
              className="flex min-w-0 flex-wrap items-baseline gap-x-2 px-2.5 py-1"
            >
              <Text size="inherit" tone="inherit" wrap="anywhere" className="min-w-0 flex-1">
                {basename(path)}
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
                  ? labels[result.status]
                  : index === current && !done
                    ? t("Fetching…")
                    : t("Waiting")}
              </Text>
              {result?.error ? (
                <ErrorDetails
                  title={t("Could not fetch {p0}", { p0: basename(path) })}
                  detail={result.error}
                />
              ) : null}
            </Text>
          );
        })}
      </ul>
    </Popover>
  );
}
