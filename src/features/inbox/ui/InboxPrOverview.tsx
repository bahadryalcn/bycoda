import type { CSSProperties } from "react";
import { DiffStat } from "../../../shared/ui/DiffStat";
import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Spinner } from "../../../shared/ui/Spinner";
import { ClampText } from "../../../shared/ui/ClampText";
import { motionAttributes } from "../../../shared/ui/Motion";
import { surfaceAttributes, Surface } from "../../../shared/ui/Surface";
import { t, useLocale } from "../../../shared/i18n";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "../../../shared/ui/icons";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { SurfaceSelection } from "../../sessions/ui/SurfaceSelection";
import type { GithubPrDiff } from "../model/githubTasks";

const EXCERPT_LINES = 4;
const EXCERPT_CHARS = 360;
const GLANCE_FILES = 6;

type DescriptionExcerpt = {
  text: string;
  images: number;
  /** True when the excerpt drops anything the full render would show. */
  truncated: boolean;
};

/**
 * Plain-text lead of a markdown body. Rendering this instead of the full
 * markdown keeps images, embeds and code blocks unloaded until asked for.
 */
export function descriptionExcerpt(body: string): DescriptionExcerpt {
  const images =
    (body.match(/!\[[^\]]*\]\([^)]*\)/g)?.length ?? 0) +
    (body.match(/<img\b/gi)?.length ?? 0) +
    (body.match(/<video\b/gi)?.length ?? 0);
  const hasBlocks = /^\s*(```|~~~|\|.*\|)/m.test(body) || /<details\b/i.test(body);
  const lines = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(```|~~~)[\s\S]*?(\1|$)/g, "")
    .replace(/<details\b[\s\S]*?(<\/details>|$)/gi, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, "")
        .replace(/(\*\*|__|~~|`)/g, "")
        .replace(/^\s*([-*_]\s*){3,}$/, "")
        .replace(/^\s*\|.*\|\s*$/, "")
        .trim(),
    )
    .filter(Boolean);
  let text = lines.slice(0, EXCERPT_LINES).join("\n");
  const clipped = text.length > EXCERPT_CHARS;
  if (clipped) text = `${text.slice(0, EXCERPT_CHARS).trimEnd()}…`;
  return {
    text,
    images,
    truncated: clipped || lines.length > EXCERPT_LINES || images > 0 || hasBlocks,
  };
}

export function InboxDescriptionSummary({ body, cwd }: { body: string; cwd: string }) {
  useLocale();
  const excerpt = useMemo(() => descriptionExcerpt(body), [body]);
  const [expanded, setExpanded] = useState(false);

  if (!body.trim()) {
    return <EmptyState size="inline" kind="empty" description={t("No description")} />;
  }
  if (!excerpt.truncated) {
    return (
      <SurfaceSelection cwd={cwd} contentVersion={body}>
        <AgentMarkdown text={body} cwd={cwd} allowRemoteMedia />
      </SurfaceSelection>
    );
  }
  return (
    <Surface
      as="section"
      variant="outline"
      data-inbox-description
      className="flex flex-col gap-2 px-3.5 py-3"
    >
      {expanded ? (
        <SurfaceSelection cwd={cwd} contentVersion={body}>
          <AgentMarkdown text={body} cwd={cwd} allowRemoteMedia />
        </SurfaceSelection>
      ) : excerpt.text ? (
        <SurfaceSelection cwd={cwd} contentVersion={body}>
          <ClampText
            as="p"
            lines={4}
            expandable={false}
            size="secondary"
            tone="secondary"
            leading="relaxed"
            className="whitespace-pre-line"
          >
            {excerpt.text}
          </ClampText>
        </SurfaceSelection>
      ) : (
        <Text as="p" size="secondary" tone="secondary">
          {t("Description is media only")}
        </Text>
      )}
      <Button
        variant="link"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="self-start"
      >
        <ChevronDown
          {...motionAttributes(
            { transition: "transform", duration: "standard", easing: "sheen" },
            `icon-sm ${expanded ? "rotate-180" : ""}`,
          )}
          strokeWidth={1.75}
        />
        {expanded ? t("Show less") : t("Show full description")}
        {!expanded && excerpt.images > 0 ? (
          <Text size="inherit" tone="secondary">
            · {excerpt.images} {excerpt.images === 1 ? t("image") : t("images")}
          </Text>
        ) : null}
      </Button>
    </Surface>
  );
}

export function InboxPrChangesGlance({
  diff,
  loading,
  error,
  onOpenFile,
}: {
  diff: GithubPrDiff | null;
  loading: boolean;
  error: string | null;
  onOpenFile: (path?: string) => void;
}) {
  useLocale();
  const files = diff?.files ?? [];
  const maxChurn = Math.max(1, ...files.map((file) => file.additions + file.deletions));
  const shown = files.slice(0, GLANCE_FILES);

  return (
    <section data-inbox-pr-glance className="flex flex-col gap-2">
      <Text as="div" size="caption" tone="secondary" className="flex items-center gap-2">
        <SectionLabel as="h2">{t("Changed files")}</SectionLabel>
        {diff ? (
          <>
            <span className="tabular-nums">
              {files.length} {files.length === 1 ? t("file") : t("files")}
            </span>
            <DiffStat
              additions={diff.additions}
              deletions={diff.deletions}
              showZero
              size="micro"
              weight="medium"
            />
          </>
        ) : null}
        {loading ? <Spinner size="xs" tone="secondary" /> : null}
        {files.length > 0 ? (
          <Button variant="ghost" type="button" onClick={() => onOpenFile()} className="ml-auto">
            {files.length > shown.length
              ? t("View all {p0}", { p0: files.length })
              : t("View diff")}
            <ChevronRight className="icon-sm" strokeWidth={1.75} />
          </Button>
        ) : null}
      </Text>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {diff && files.length === 0 ? (
        <EmptyState size="inline" kind="empty" description={t("No file changes")} />
      ) : shown.length > 0 ? (
        <Surface
          as="ul"
          variant="outline"
          padding="none"
          dividers="neutral"
          className="flex flex-col overflow-hidden"
        >
          {shown.map((file) => {
            const slash = file.path.lastIndexOf("/");
            const dir = slash >= 0 ? file.path.slice(0, slash + 1) : "";
            const name = file.path.slice(slash + 1);
            const churn = file.additions + file.deletions;
            const width = Math.max(8, Math.round((churn / maxChurn) * 48));
            const added = churn > 0 ? (file.additions / churn) * width : 0;
            return (
              <li key={file.path}>
                <Button
                  variant="ghost"
                  type="button"
                  tooltip={file.path}
                  tooltipWhen="overflow"
                  onClick={() => onOpenFile(file.path)}
                  align="start"
                  className="w-full min-w-0"
                >
                  <FileTypeIcon name={name} isDir={false} />
                  <Text
                    size="caption"
                    tone="inherit"
                    className="flex min-w-0 flex-1 flex-wrap font-mono"
                  >
                    <Text size="inherit" tone="secondary" truncate className="min-w-0">
                      {dir}
                    </Text>
                    <Text size="inherit" tone="secondary" className="min-w-0 wrap-anywhere">
                      {name}
                    </Text>
                  </Text>
                  <span
                    aria-hidden
                    {...surfaceAttributes(
                      { radius: "pill" },
                      "flex h-1.5 shrink-0 overflow-hidden @max-[420px]/linked:hidden [width:var(--layout-width)]",
                    )}
                    style={
                      {
                        "--layout-width": width === undefined ? undefined : width + "px",
                      } as CSSProperties
                    }
                  >
                    <span
                      {...surfaceAttributes(
                        { variant: "diff-add" },
                        "shrink-0 [width:var(--layout-added-width)]",
                      )}
                      style={{ "--layout-added-width": `${added}px` } as CSSProperties}
                    />
                    <span {...surfaceAttributes({ variant: "diff-delete" }, "flex-1")} />
                  </span>
                  <DiffStat
                    additions={file.additions}
                    deletions={file.deletions}
                    size="micro"
                    weight="medium"
                    className="w-20 shrink-0 justify-end"
                  />
                </Button>
              </li>
            );
          })}
        </Surface>
      ) : null}
    </section>
  );
}
