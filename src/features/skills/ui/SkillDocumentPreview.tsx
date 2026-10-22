import { MarkdownDocumentPreview } from "../../sessions/ui/MarkdownDocumentPreview";
import { SurfaceSelection } from "../../sessions/ui/SurfaceSelection";

/** Keep the skill's YAML header readable without interpreting it as Markdown. */
export function SkillDocumentPreview({ text }: { text: string }) {
  return (
    <SurfaceSelection contentVersion={text}>
      <MarkdownDocumentPreview text={text} metadataLabel="Skill metadata" />
    </SurfaceSelection>
  );
}
