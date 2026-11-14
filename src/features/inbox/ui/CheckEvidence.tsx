import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { surfaceAttributes, Surface } from "../../../shared/ui/Surface";
import { t, useLocale } from "../../../shared/i18n";
import { openUrlSafely } from "../../../shared/lib/openUrlSafely";
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
  provider,
  cwd,
  repo,
  headOid,
}: {
  annotations: Annotation[];
  provider?: "github" | "gitlab" | "azuredevops";
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
          provider={provider}
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
  provider,
  cwd,
  repo,
  headOid,
  sources,
}: {
  annotation: Annotation;
  provider?: "github" | "gitlab" | "azuredevops";
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
    (!provider || provider === "github") && validRepo && validPath && validCommit
      ? `https://github.com/${repo}/blob/${headOid}/${relative.split("/").map(encodeURIComponent).join("/")}${validLine ? `#L${annotation.line}` : ""}`
      : null;
  const location = `${annotation.path}${validLine ? `:${annotation.line}` : ""}`;
  const [messageTitle, ...messageLines] = annotation.message.split(/\r?\n/);
  const levelLabel =
    annotation.level === "failure"
      ? t("Failed")
      : annotation.level === "warning"
        ? t("Warning")
        : annotation.level;
  const Mark = annotation.level === "failure" ? CircleX : AlertCircle;
  return (
    <Surface variant="outline" padding="none" className="overflow-hidden">
      {annotation.path ? (
        <Text
          as="div"
          size="caption"
          tone="secondary"
          {...surfaceAttributes(
            { frame: "neutral", edge: "bottom", variant: "fill-subtle" },
            "flex min-w-0 items-center gap-1.5 px-3 py-2",
          )}
        >
          <FileTypeIcon name={annotation.path} isDir={false} />
          <span className="min-w-0 flex-1 break-all">{location}</span>
          {fileUrl ? (
            <Button
              iconOnly
              label={t("View {p0} on GitHub", { p0: location })}
              variant="ghost"
              type="button"
              tooltip={t("View source at the checked commit")}
              aria-label={t("View {p0} on GitHub", { p0: location })}
              onClick={() => openUrlSafely(fileUrl)}
              className="-my-1 -mr-1 shrink-0"
            >
              <ExternalLink className="icon-xs" strokeWidth={1.75} />
            </Button>
          ) : null}
        </Text>
      ) : null}
      {excerpt.length ? (
        <Text
          as="div"
          size="micro"
          tone="inherit"
          leading="relaxed"
          className="overflow-x-auto py-2 font-mono"
          aria-label={t("Source at {p0}", { p0: headOid })}
        >
          {excerpt.map((line, index) => (
            <Text
              as="div"
              key={index}
              size="inherit"
              tone={firstLine + index === annotation.line ? "neutral" : "secondary"}
              {...surfaceAttributes(
                {
                  tone: firstLine + index === annotation.line ? "danger" : undefined,
                  bar:
                    firstLine + index === annotation.line
                      ? "diagnostic-danger"
                      : "diagnostic-empty",
                },
                "flex min-w-max gap-4 pr-3",
              )}
            >
              <Text
                size="inherit"
                tone="secondary"
                className="w-8 shrink-0 select-none text-right tabular-nums"
              >
                {firstLine + index}
              </Text>
              <code className="whitespace-pre">{line || " "}</code>
            </Text>
          ))}
        </Text>
      ) : null}
      <div
        {...surfaceAttributes(
          {
            frame: excerpt.length ? "neutral" : undefined,
            edge: excerpt.length ? "top" : undefined,
          },
          "flex min-w-0 items-start gap-2 px-3 py-3",
        )}
      >
        <Mark
          tone={annotation.level === "failure" ? "danger" : "warning"}
          className="mt-0.5 icon-xs shrink-0"
          strokeWidth={1.75}
        />
        <div className="min-w-0 flex-1">
          <Text
            as="p"
            size="caption"
            tone="secondary"
            className="max-h-32 overflow-auto whitespace-pre-wrap break-words"
          >
            {levelLabel ? (
              <>
                <Text size="inherit" tone="neutral" weight="medium">
                  {levelLabel}
                </Text>
                {" · "}
              </>
            ) : null}
            {messageTitle}
          </Text>
          {messageLines.length ? (
            <OutputBlock size="micro" leading="relaxed" className="mt-1.5 max-h-60 overflow-auto">
              {messageLines.join("\n")}
            </OutputBlock>
          ) : null}
          {canRead && source?.key === sourceKey && !excerpt.length ? (
            <Text as="p" size="caption" tone="secondary" className="mt-2">
              {t("Source preview unavailable for this commit.")}
            </Text>
          ) : null}
        </div>
      </div>
    </Surface>
  );
}
