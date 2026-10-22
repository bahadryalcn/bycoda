import { memo, useMemo } from "react";
import { splitMarkdownFrontmatter } from "../../../shared/lib/markdownFrontmatter";
import { ChevronDown, ChevronRight } from "../../../shared/ui/icons";
import type { OpenFileFn } from "../../search/model/search";
import { MarkdownPreview } from "./AgentMarkdown";

export const MarkdownDocumentPreview = memo(function MarkdownDocumentPreview({
  text,
  metadataLabel,
  cwd,
  onOpenFile,
  documentPath,
}: {
  text: string;
  metadataLabel: string;
  cwd?: string;
  onOpenFile?: OpenFileFn;
  /** The Markdown file shown, whose images load from the project, `cwd`. */
  documentPath?: string;
}) {
  const document = useMemo(() => splitMarkdownFrontmatter(text), [text]);

  return (
    <MarkdownPreview
      text={document.body}
      cwd={cwd}
      onOpenFile={onOpenFile}
      documentPath={documentPath}
      hardBreaks
      header={
        document.metadata !== null ? (
          <details className="group/metadata mb-6 rounded-lg border border-(--ui-tone-neutral-border) bg-(--ui-tone-neutral-solid)/[0.03]">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] text-(--ui-text-secondary) hover:text-(--ui-tone-neutral-fg) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-focus-ring-color) [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 shrink-0 text-(--ui-text-secondary) group-open/metadata:hidden"
                strokeWidth={1.75}
              />
              <ChevronDown
                aria-hidden="true"
                className="hidden size-3.5 shrink-0 text-(--ui-text-secondary) group-open/metadata:block"
                strokeWidth={1.75}
              />
              {metadataLabel}
            </summary>
            <pre className="whitespace-pre-wrap break-words border-t border-(--ui-tone-neutral-border) px-3 py-2 font-mono text-[12px] leading-5 text-(--ui-text-secondary)">
              {document.metadata}
            </pre>
          </details>
        ) : null
      }
    />
  );
});
