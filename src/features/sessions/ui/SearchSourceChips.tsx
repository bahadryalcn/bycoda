import { openExternal } from "../../../platform/tauri/openExternal";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import type { SearchSource } from "../model/searchSources";

/**
 * The pages a web search returned, numbered the way the reply cites them. Each chip shows
 * the number and domain; the page title is the tooltip, so it adds what the label lacks.
 */
export function SearchSourceChips({
  sources,
  inset = true,
}: {
  sources: readonly SearchSource[] | undefined;
  /** Align under the row's label (the row icon's width) when the row is not a bare chip. */
  inset?: boolean;
}) {
  if (!sources?.length) return null;
  return (
    <ol
      data-search-sources
      className={`m-0 flex min-w-0 list-none flex-wrap gap-1 p-0 pb-1 ${inset ? "ps-5" : ""}`}
    >
      {sources.map((source, index) => (
        <li key={source.url} className="flex min-w-0 max-w-full">
          <Button
            variant="chip"
            motion="none"
            type="button"
            className="min-w-0 max-w-full"
            tooltip={source.title}
            tooltipWide
            onClick={(event) => {
              event.stopPropagation();
              void openExternal(source.url).catch(() => {});
            }}
          >
            <Text size="inherit" className="shrink-0 tabular-nums">
              {index + 1}
            </Text>
            <Text size="inherit" truncate className="min-w-0">
              {source.domain}
            </Text>
          </Button>
        </li>
      ))}
    </ol>
  );
}
