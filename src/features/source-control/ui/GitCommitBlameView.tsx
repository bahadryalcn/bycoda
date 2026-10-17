import { useCallback, useMemo } from "react";
import { gitBlame } from "../../../platform/tauri/fs";
import { t, useLocale } from "../../../shared/i18n/git";
import { useGitResource } from "../hooks/useGitResource";
import { GitFeedback, GitLoading } from "./GitFeedback";

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
      {resource.loading && !resource.data ? <GitLoading text="Loading…" /> : null}
      {!sha ? (
        <p className="p-3 text-[12px] text-[var(--ui-text-secondary)]">{t("No commits yet")}</p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-6">
        {resource.data?.map((entry, index) => {
          const first = resource.data?.[index - 1]?.sha !== entry.sha;
          return (
            <div
              key={entry.line}
              className={`flex whitespace-pre ${first ? "border-t border-stroke/60" : ""}`}
            >
              <span
                title={`${entry.sha}\n${entry.author} · ${entry.summary}`}
                className="sticky left-0 w-44 shrink-0 truncate bg-[var(--ui-surface)] px-2 font-sans text-[11px] text-[var(--ui-text-secondary)]"
              >
                {first ? `${entry.shortSha} ${entry.author}` : ""}
              </span>
              <span className="w-10 shrink-0 pr-2 text-right text-[var(--ui-text-muted)] select-none">
                {entry.line}
              </span>
              <span className="pr-3 text-content">{lines[entry.line - 1] ?? ""}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
