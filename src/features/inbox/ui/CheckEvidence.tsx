import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { AlertCircle, CircleX, ExternalLink } from "../../../shared/ui/icons";
import { gitCommitFileDiff } from "../../../platform/tauri/fs";
import type { GithubCheckDetails } from "../model/githubPrChecks";

type Annotation = GithubCheckDetails["annotations"][number];
type SourceCache = Map<string, Promise<string | null>>;

/** Source previews share reads within a job and always use its checked commit. */
export function CheckEvidence({
  annotations,
  cwd,
  repo,
  headOid,
}: {
  annotations: Annotation[];
  cwd: string;
  repo: string;
  headOid: string;
}) {
  useLocale();
  const [showAll, setShowAll] = useState(false);
  const sources = useMemo<SourceCache>(() => new Map(), [cwd, headOid]);
  return (
    <div className="min-w-0 space-y-3">
      {(showAll ? annotations : annotations.slice(0, 5)).map((annotation, index) => (
        <CheckAnnotation
          key={`${headOid}:${annotation.path}:${annotation.line}:${index}`}
          annotation={annotation}
          cwd={cwd}
          repo={repo}
          headOid={headOid}
          sources={sources}
        />
      ))}
      {!showAll && annotations.length > 5 ? (
        <Button variant="ghost" type="button" onClick={() => setShowAll(true)}>
          {t("Show ")}
          {annotations.length - 5}
          {t(" more annotations")}
        </Button>
      ) : null}
    </div>
  );
}

function CheckAnnotation({
  annotation,
  cwd,
  repo,
  headOid,
  sources,
}: {
  annotation: Annotation;
  cwd: string;
  repo: string;
  headOid: string;
  sources: SourceCache;
}) {
  useLocale();
  const relative = annotation.path.replace(/^\.\//, "");
  const validPath =
    Boolean(relative) &&
    !/[\\:\x00-\x1f]/.test(relative) &&
    relative.split("/").every((part) => part && part !== "." && part !== "..");
  const validCommit = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(headOid);
  const validLine = Number.isSafeInteger(annotation.line) && annotation.line > 0;
  const canRead = Boolean(cwd) && validPath && validCommit && validLine;
  const sourceKey = `${cwd}:${headOid}:${relative}`;
  const [source, setSource] = useState<{
    key: string;
    text: string | null;
  } | null>(null);
  useEffect(() => {
    if (!canRead) return;
    let active = true;
    let request = sources.get(relative);
    if (!request) {
      request = gitCommitFileDiff(cwd, headOid, relative)
        .then((file) =>
          file && !file.binary && !file.tooLarge && typeof file.current === "string"
            ? file.current
            : null,
        )
        .catch(() => null);
      sources.set(relative, request);
    }
    void request.then((text) => {
      if (active) setSource({ key: sourceKey, text });
    });
    return () => {
      active = false;
    };
  }, [canRead, cwd, headOid, relative, sourceKey, sources]);
  const text = source?.key === sourceKey ? source.text : null;
  const lines = text?.split(/\r?\n/);
  const firstLine = Math.max(1, annotation.line - 1);
  const excerpt =
    lines && annotation.line <= lines.length ? lines.slice(firstLine - 1, annotation.line + 1) : [];
  const validRepo =
    /^[\w.-]+\/[\w.-]+$/.test(repo) &&
    repo.split("/").every((part) => part !== "." && part !== "..");
  const fileUrl =
    validRepo && validPath && validCommit
      ? `https://github.com/${repo}/blob/${headOid}/${relative.split("/").map(encodeURIComponent).join("/")}${validLine ? `#L${annotation.line}` : ""}`
      : null;
  const location = `${annotation.path}${validLine ? `:${annotation.line}` : ""}`;
  const [messageTitle, ...messageLines] = annotation.message.split(/\r?\n/);
  const Mark = annotation.level === "failure" ? CircleX : AlertCircle;
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-(--ui-tone-neutral-border) bg-(--ui-surface)">
      {annotation.path ? (
        <div className="flex min-w-0 items-center gap-1.5 border-b border-(--ui-tone-neutral-border) bg-(--ui-surface-hover) px-3 py-2 text-[12px] text-(--ui-text-secondary)">
          <FileTypeIcon name={annotation.path} isDir={false} size={13} />
          <span title={location} className="min-w-0 flex-1 truncate">
            {location}
          </span>
          {fileUrl ? (
            <Button
              iconOnly
              label={t("View {p0} on GitHub", { p0: location })}
              variant="ghost"
              type="button"
              title={t("View source at the checked commit")}
              aria-label={t("View {p0} on GitHub", { p0: location })}
              onClick={() => void openUrl(fileUrl)}
              className="-my-1 -mr-1 shrink-0"
            >
              <ExternalLink className="size-3" strokeWidth={1.75} />
            </Button>
          ) : null}
        </div>
      ) : null}
      {excerpt.length ? (
        <div
          className="overflow-x-auto py-2 font-mono text-[11px] leading-5"
          aria-label={t("Source at {p0}", { p0: headOid })}
        >
          {excerpt.map((line, index) => (
            <div
              key={index}
              className={`flex min-w-max gap-4 border-l-2 pr-3 ${firstLine + index === annotation.line ? "border-(--ui-tone-danger-border) bg-(--ui-tone-danger-subtle)/[0.06] text-(--ui-text-secondary)" : "border-transparent text-(--ui-text-secondary)"}`}
            >
              <span className="w-8 shrink-0 select-none text-right tabular-nums text-(--ui-text-secondary)">
                {firstLine + index}
              </span>
              <code className="whitespace-pre">{line || " "}</code>
            </div>
          ))}
        </div>
      ) : null}
      <div
        className={`flex min-w-0 items-start gap-2 px-3 py-3 ${excerpt.length ? "border-t border-(--ui-tone-neutral-border)" : ""}`}
      >
        <Mark
          className={`mt-0.5 size-3 shrink-0 ${annotation.level === "failure" ? "text-(--ui-tone-danger-fg)" : "text-(--ui-tone-warning-fg)"}`}
          strokeWidth={1.75}
        />
        <div className="min-w-0 flex-1">
          <p className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-[12px] text-(--ui-text-secondary)">
            {messageTitle}
          </p>
          {messageLines.length ? (
            <pre className="mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-(--ui-text-secondary)">
              {messageLines.join("\n")}
            </pre>
          ) : null}
          {canRead && source?.key === sourceKey && !excerpt.length ? (
            <p className="mt-2 text-(length:--ui-font-caption) text-(--ui-text-secondary)">
              {t("Source preview unavailable for this commit.")}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
