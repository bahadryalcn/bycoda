import { startTransition, useEffect, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useLocale, useT } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { FileTypeIcon } from "../../files/public/FileTypeIcon";
import type { ProjectSearchMatch } from "../../search";

type MatchGroup = {
  path: string;
  relative: string;
  directory: string;
  name: string;
  start: number;
  matches: ProjectSearchMatch[];
};

// Enough matches to fill a tall sidebar before offscreen groups are committed.
const MATCH_BATCH = 48;

type MatchActions = {
  openMatch: (match: ProjectSearchMatch, pin?: boolean) => void;
  query: string;
  caseSensitive: boolean;
  regex: boolean;
};

export function ProjectSearchResults({
  groups,
  count,
  openMatch,
  query,
  caseSensitive,
  regex,
}: {
  groups: MatchGroup[];
  count: number;
} & MatchActions) {
  const [visibleCount, setVisibleCount] = useState(MATCH_BATCH);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Append offscreen results in batches after the first visible rows have painted.
  useEffect(() => {
    if (visibleCount >= count) return;
    const frame = requestAnimationFrame(() => {
      startTransition(() => setVisibleCount((current) => current + 2 * MATCH_BATCH));
    });
    return () => cancelAnimationFrame(frame);
  }, [count, visibleCount]);

  // The browser resolves End and the next Tab stop after this event returns.
  const revealForKey = useStableCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (visibleCount >= count) return;
      if (event.key === "End") {
        flushSync(() => setVisibleCount(count));
      } else if (event.key === "Tab" && !event.shiftKey && index === visibleCount - 1) {
        flushSync(() => setVisibleCount((current) => current + MATCH_BATCH));
      }
    },
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
      {groups
        .filter((group) => group.start < visibleCount)
        .map((group) => (
          <FileMatches
            key={group.path}
            group={group}
            count={Math.min(visibleCount - group.start, group.matches.length)}
            query={query}
            caseSensitive={caseSensitive}
            regex={regex}
            openMatch={openMatch}
            onResultKey={revealForKey}
          />
        ))}
    </div>
  );
}

function FileMatches({
  group,
  count,
  openMatch,
  onResultKey,
  query,
  caseSensitive,
  regex,
}: {
  group: MatchGroup;
  onResultKey: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  count: number;
} & MatchActions) {
  const t = useT();
  const rows = count < group.matches.length ? group.matches.slice(0, count) : group.matches;
  return (
    <section {...surfaceAttributes({ frame: "pane", edge: "bottom" }, "")}>
      {/* The folder follows the name, so duplicate basenames stay distinguishable without repeating the name. */}
      <div className="flex min-w-0 items-start gap-1.5 px-2 py-1">
        <FileTypeIcon name={group.name} isDir={false} size="md" />
        <div className="min-w-0 flex-1">
          <Text as="div" wrap="anywhere" size="caption" tone="primary" weight="medium">
            {group.name}
          </Text>
          {group.directory ? (
            <Text as="div" wrap="anywhere" size="micro" tone="muted">
              {group.directory}
            </Text>
          ) : null}
        </div>
        <Badge variant="count" size="xs" tone="accent" max={Infinity}>
          {group.matches.length}
        </Badge>
      </div>
      <ul>
        {rows.map((match, index) => (
          <li key={`${match.path}:${match.line}:${match.column}`}>
            <Button
              variant="item"
              motion="none"
              type="button"
              onKeyDown={(event) => onResultKey(event, group.start + index)}
              onClick={() => openMatch(match)}
              onDoubleClick={() => openMatch(match, true)}
              className="flex w-full items-start gap-2 text-left"
            >
              <Text
                role="img"
                aria-label={t("Line {p0}", { p0: match.line })}
                size="micro"
                tone="muted"
                className="w-7 shrink-0 pt-0 text-right font-mono tabular-nums"
              >
                {match.line}
              </Text>
              <Text
                as="span"
                size="micro"
                tone="primary"
                leading="relaxed"
                truncate
                className="min-w-0 flex-1 font-mono"
              >
                <MatchPreview
                  preview={match.preview.trimEnd()}
                  query={query}
                  caseSensitive={caseSensitive}
                  regex={regex}
                />
              </Text>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function groupMatches(matches: ProjectSearchMatch[]): MatchGroup[] {
  const byPath = new Map<string, MatchGroup>();
  for (const match of matches) {
    const existing = byPath.get(match.path);
    if (existing) {
      existing.matches.push(match);
      continue;
    }
    const slash = match.relative.lastIndexOf("/");
    byPath.set(match.path, {
      path: match.path,
      relative: match.relative,
      directory: slash < 0 ? "" : match.relative.slice(0, slash),
      name: match.relative.slice(slash + 1),
      start: 0,
      matches: [match],
    });
  }
  const groups = [...byPath.values()];
  let start = 0;
  for (const group of groups) {
    group.start = start;
    start += group.matches.length;
  }
  return groups;
}

function MatchPreview({
  preview,
  query,
  caseSensitive,
  regex,
}: {
  preview: string;
  query: string;
  caseSensitive: boolean;
  regex: boolean;
}) {
  useLocale();
  const range = highlightRange(preview, query, caseSensitive, regex);
  if (!range) return <>{preview}</>;
  const [start, end] = range;
  return (
    <>
      {preview.slice(0, start)}
      <Text
        as="mark"
        size="inherit"
        tone="primary"
        {...surfaceAttributes({ radius: "sm", tone: "accent" })}
      >
        {preview.slice(start, end)}
      </Text>
      {preview.slice(end)}
    </>
  );
}

/** The `[start, end)` span of the first match of `query` in `preview`, or `null`. */
function highlightRange(
  preview: string,
  query: string,
  caseSensitive: boolean,
  regex: boolean,
): [number, number] | null {
  if (!query) return null;
  if (regex) {
    try {
      const match = preview.match(new RegExp(query, caseSensitive ? "" : "i"));
      if (!match || match.index == null) return null;
      return [match.index, match.index + match[0].length];
    } catch {
      return null;
    }
  }
  const source = caseSensitive ? preview : preview.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const index = source.indexOf(needle);
  return index < 0 ? null : [index, index + needle.length];
}
