import { MarkdownDocumentPreview } from "../../sessions/ui/MarkdownDocumentPreview";
import { SurfaceSelection } from "../../sessions/ui/SurfaceSelection";

/** Keep the skill's YAML header readable without interpreting it as Markdown. */
export function SkillDocumentPreview({
  text,
  className,
  cwd,
  documentPath,
}: {
  text: string;
  className?: string;
  cwd?: string;
  documentPath?: string;
}) {
  return (
    <SurfaceSelection contentVersion={text} className={className} cwd={cwd}>
      <MarkdownDocumentPreview
        text={text}
        metadataLabel="Skill metadata"
        cwd={cwd}
        documentPath={documentPath}
      />
    </SurfaceSelection>
  );
}
