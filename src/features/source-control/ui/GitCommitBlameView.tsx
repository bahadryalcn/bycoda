import { Tooltip } from "../../../shared/ui/Tooltip";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useCallback, useMemo } from "react";
import { gitBlame } from "../../../platform/tauri/fs";
import { t, useLocale } from "../../../shared/i18n/git";
import { useGitResource } from "../hooks/useGitResource";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { LoadingText } from "../../../shared/ui/LoadingText";
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
        <LoadingText className="px-3 py-2">{t("Loading…")}</LoadingText>
      ) : null}
      {!sha ? (
        <EmptyState size="inline" className="px-3" description={t("No commits yet")} />
      ) : null}
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
              <Tooltip label={`${entry.sha}\n${entry.author} · ${entry.summary}`} asChild>
                <Text
                  size="micro"
                  tone="secondary"
                  truncate
                  {...surfaceAttributes(
                    { variant: "base" },
                    "sticky left-0 w-44 shrink-0 px-2 font-sans",
                  )}
                >
                  {first ? `${entry.shortSha} ${entry.author}` : ""}
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
