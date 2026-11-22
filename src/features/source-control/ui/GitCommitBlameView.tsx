import { Tooltip } from "../../../shared/ui/Tooltip";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useCallback, useMemo } from "react";
import { gitBlame } from "../../../platform/tauri/fs";
import { t, useLocale } from "../../../shared/i18n/git";
import { useGitResource } from "../hooks/useGitResource";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { useMinuteNow } from "../../../shared/hooks/useMinuteNow";
import { formatAbsoluteTime, formatRelativeTime } from "../model/gitGraphDisplay";
import { GitFeedback } from "./GitFeedback";

/** Historical attribution paired with the same revision's file content. */
export function GitCommitBlameView({
  cwd,
  sha,
  relative,
  text,
}: {
  cwd: string;
  sha: string | undefined;
  relative: string;
  text: string;
}) {
  useLocale();
  const read = useCallback(() => gitBlame(cwd, relative, sha), [cwd, relative, sha]);
  const resource = useGitResource(
    cwd,
    `commit-blame:${cwd}:${sha}:${relative}`,
    !!sha,
    read,
    false,
  );
  const now = useMinuteNow();
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  return (
    <section aria-label={t("Blame at commit")} className="flex min-h-0 flex-1 flex-col">
      {resource.error ? (
        <GitFeedback
          title={t("Couldn’t load file information")}
          detail={resource.error}
          onRetry={resource.refresh}
        />
      ) : null}
      {resource.loading && !resource.data ? (
        <LoadingText inset="row">{t("Loading…")}</LoadingText>
      ) : null}
      {!sha ? <EmptyState size="inline" inset="row" description={t("No commits yet")} /> : null}
      <Text
        as="div"
        size="caption"
        tone="inherit"
        leading="inherit"
        className="min-h-0 flex-1 overflow-auto font-mono leading-6"
      >
        {resource.data?.map((entry, index) => {
          const first = resource.data?.[index - 1]?.sha !== entry.sha;
          return (
            <div
              key={entry.line}
              {...surfaceAttributes(
                {
                  frame: first ? "pane" : undefined,
                  edge: first ? "top" : undefined,
                },
                "flex whitespace-pre",
              )}
            >
              <Tooltip
                label={first ? entry.summary : undefined}
                details={
                  first ? [`${entry.shortSha} · ${formatAbsoluteTime(entry.timestamp)}`] : []
                }
                asChild
              >
                <Text
                  as="div"
                  size="micro"
                  tone="secondary"
                  tabIndex={first ? 0 : undefined}
                  {...surfaceAttributes(
                    { variant: "canvas" },
                    "sticky left-0 flex w-64 shrink-0 items-baseline gap-2 px-2 font-sans",
                  )}
                >
                  {first ? (
                    <>
                      <span className="shrink-0 font-mono">{entry.shortSha}</span>
                      <span className="min-w-0 flex-1 truncate">{entry.author}</span>
                      <span className="shrink-0 tabular-nums">
                        {formatRelativeTime(entry.timestamp, now)}
                      </span>
                    </>
                  ) : null}
                </Text>
              </Tooltip>
              <Text
                size="inherit"
                tone="muted"
                className="w-10 shrink-0 pr-2 text-right select-none"
              >
                {entry.line}
              </Text>
              <Text size="inherit" tone="primary" className="pr-3">
                {lines[entry.line - 1] ?? ""}
              </Text>
            </div>
          );
        })}
      </Text>
    </section>
  );
}
