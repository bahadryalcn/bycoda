import { HtmlPreview } from "../../files/public/HtmlPreview";
import { sandboxedInlineVisual } from "../model/inlineVisual";
import { useInlineVisualScheme } from "./InlineVisual";

/**
 * HTML a reply wrote (an ```html fence, an `<iframe srcdoc>`), drawn like an inline visual: an
 * opaque sandbox whose policy lets its own scripts and styles run but reaches no network, file
 * or app capability.
 * shortcut: a fixed 360px box; size it to the page if replies start showing tall documents.
 */
export function HtmlSnippetPreview({ html }: { html: string }) {
  const scheme = useInlineVisualScheme();
  return (
    <div data-html-fence-preview className="h-90 min-h-0">
      <HtmlPreview
        path="remote://inline-visual/snapshot.html"
        source={sandboxedInlineVisual(html, scheme.dark, scheme.theme)}
        active
        compact
      />
    </div>
  );
}
