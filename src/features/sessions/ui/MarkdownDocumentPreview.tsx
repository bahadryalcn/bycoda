import { memo } from "react";
import { splitMarkdownFrontmatter } from "../../../shared/lib/markdownFrontmatter";
import { Disclosure } from "../../../shared/ui/Disclosure";
import type { OpenFileFn } from "../../search/model/search";
import { MarkdownPreview } from "./AgentMarkdown";
import { OutputBlock } from "../../../shared/ui/OutputBlock";

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
  const document = splitMarkdownFrontmatter(text);

  return (
    <MarkdownPreview
      text={document.body}
      cwd={cwd}
      onOpenFile={onOpenFile}
      documentPath={documentPath}
      hardBreaks
      header={
        document.metadata !== null ? (
          <Disclosure size="sm" variant="card" summary={metadataLabel} className="mb-6">
            <OutputBlock className="border-t border-(--ui-tone-neutral-border) px-3 py-2">
              {document.metadata}
            </OutputBlock>
          </Disclosure>
        ) : null
      }
    />
  );
});
