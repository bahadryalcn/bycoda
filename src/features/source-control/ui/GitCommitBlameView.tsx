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
              className={`flex whitespace-pre ${first ? "border-t border-(--ui-pane-border)" : ""}`}
            >
              <Text
                title={`${entry.sha}\n${entry.author} · ${entry.summary}`}
                size="micro"
                tone="secondary"
                truncate
                className="sticky left-0 w-44 shrink-0 bg-(--color-background-base) px-2 font-sans"
              >
                {first ? `${entry.shortSha} ${entry.author}` : ""}
              </Text>
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
