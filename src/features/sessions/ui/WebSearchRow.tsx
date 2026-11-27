import { useEffect, useState } from "react";
import { useFormat, useT } from "../../../shared/i18n";
import { openExternal } from "../../../platform/tauri/openExternal";
import { Button } from "../../../shared/ui/Button";
import { ClampText } from "../../../shared/ui/ClampText";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Motion, motionAttributes } from "../../../shared/ui/Motion";
import { SkeletonBar } from "../../../shared/ui/Skeleton";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { Avatar } from "../../../shared/ui/identity";
import { Globe } from "../../../shared/ui/icons";
import type { Block } from "../model/session";
import type { SearchSource } from "../model/searchSources";
import { fetchLinkPreviewMetadata } from "../model/linkPreview";
import { useNearViewport } from "./useNearViewport";
import { useRetainedDisclosure } from "./useRetainedDisclosure";

/** Cards in one row; past this the last slot sums up the rest until the reader asks for all. */
const COLUMNS = 4;
const PLACEHOLDERS = 3;
/** How far each stacked site icon moves aside while the pill is hovered, so they fan out. */
const FAN = [
  "",
  "group-hover/web-search:translate-x-0.5",
  "group-hover/web-search:translate-x-1",
  "group-hover/web-search:translate-x-1.5",
];
const CARD_GRID =
  "m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,9.5rem),1fr))] gap-2 p-0 px-2 pb-2 pt-1";

/** The site's favicon once it loads (fetched near the viewport, cached per site), its initial before. */
function SiteIcon({ domain, load }: { domain: string; load: boolean }) {
  const [favicon, setFavicon] = useState<string | null>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- loads the site's favicon through the link preview fetch once the row nears the viewport; a stale reply is dropped
  useEffect(() => {
    if (!load) return;
    let current = true;
    fetchLinkPreviewMetadata(`https://${domain}/`).then(
      (metadata) => {
        if (current) setFavicon(metadata.faviconDataUrl);
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [domain, load]);
  return <Avatar size="xs" tone="accent" src={favicon} fallback={domain.charAt(0).toUpperCase()} />;
}

/** Up to four site icons, overlapped at rest and fanned out while the pill is hovered. */
function SiteStack({ sources, load }: { sources: readonly SearchSource[]; load: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center pe-1.5" aria-hidden>
      {sources.slice(0, FAN.length).map((source, index) => (
        <Motion
          key={source.url}
          as="span"
          duration="standard"
          className={`inline-flex ${index ? "-ms-1" : ""} ${FAN[index]}`}
        >
          <span {...surfaceAttributes({ radius: "circle", ring: "panel-outer" }, "inline-flex")}>
            <SiteIcon domain={source.domain} load={load} />
          </span>
        </Motion>
      ))}
    </span>
  );
}

function SourceCard({
  source,
  index,
  load,
}: {
  source: SearchSource;
  index: number;
  load: boolean;
}) {
  const format = useFormat();
  return (
    <Button
      variant="secondary"
      layout="stacked"
      align="start"
      controlHeight="fill"
      controlMinHeight="large"
      motion="none"
      type="button"
      className="w-full min-w-0"
      tooltip={source.url}
      tooltipWide
      onClick={(event) => {
        event.stopPropagation();
        void openExternal(source.url).catch(() => {});
      }}
    >
      <span className="flex h-full w-full min-w-0 flex-col justify-between gap-2">
        <ClampText
          as="span"
          lines={2}
          expandable={false}
          size="caption"
          weight="medium"
          wrap="normal"
        >
          {source.title}
        </ClampText>
        <span className="flex min-w-0 items-center gap-1">
          <SiteIcon domain={source.domain} load={load} />
          <Text size="micro" tone="muted" truncate className="min-w-0 flex-1">
            {source.domain}
          </Text>
          <Text size="micro" tone="muted" className="shrink-0">
            {format.formatNumber(index)}
          </Text>
        </span>
      </span>
    </Button>
  );
}

/**
 * A web search in the transcript: a pill with the globe, what it found and the sites it read,
 * over a row of source cards. While it runs the label sweeps and empty cards hold the places the
 * results will take.
 */
export function WebSearchRow({ block, working }: { block: Block; working: boolean }) {
  const t = useT();
  const format = useFormat();
  const preview = block.tool?.preview;
  const sources = preview?.sources ?? [];
  const query = preview?.query?.trim() ?? "";
  const [open, setOpen] = useRetainedDisclosure<boolean>(`WebSearchRow:${block.id}`, true);
  const [showAll, setShowAll] = useState(false);
  const [rowRef, near] = useNearViewport<HTMLDivElement>();

  const label = working
    ? t("Searching the web")
    : sources.length === 1
      ? t("Searched 1 site")
      : sources.length > 1
        ? t("Searched {p0} sites", { p0: format.formatNumber(sources.length) })
        : t("Searched the web");
  const pill = (
    <span
      {...surfaceAttributes(
        { variant: "inset", radius: "pill" },
        "group/web-search inline-flex min-w-0 max-w-full items-center gap-2 py-0.5 ps-0.5 pe-3",
      )}
    >
      <Avatar size="sm" fallback={<Globe className="icon-xs" strokeWidth={1.75} />} />
      {working ? (
        <WorkingIndicator glyph={false} truncate text={{ size: "secondary", weight: "medium" }}>
          {label}
        </WorkingIndicator>
      ) : (
        <Text size="secondary" weight="medium" tone="primary" className="shrink-0">
          {label}
        </Text>
      )}
      {query ? (
        <Text size="secondary" tone="muted" truncate className="min-w-0">
          {query}
        </Text>
      ) : null}
      {sources.length ? <SiteStack sources={sources} load={near} /> : null}
    </span>
  );

  const folded = !showAll && sources.length > COLUMNS;
  const shown = folded ? sources.slice(0, COLUMNS - 1) : sources;
  const rest = sources.slice(shown.length);
  const name = query || label;

  return (
    <div ref={rowRef} className="transcript-tool-row flex min-w-0 flex-col" data-web-search>
      {sources.length ? (
        <Disclosure
          variant="step"
          chevron="end"
          open={open}
          onOpenChange={setOpen}
          summaryLabel={
            open
              ? t("Hide sources for {p0}", { p0: name })
              : t("Show sources for {p0}", { p0: name })
          }
          summary={pill}
        >
          {open ? (
            <ol className={CARD_GRID} data-search-sources>
              {shown.map((source, index) => (
                <li
                  key={source.url}
                  {...motionAttributes({ enter: "rise", duration: "standard" }, "flex min-w-0")}
                >
                  <SourceCard source={source} index={index + 1} load={near} />
                </li>
              ))}
              {folded ? (
                <li {...motionAttributes({ enter: "rise", duration: "standard" }, "flex min-w-0")}>
                  <Button
                    variant="secondary"
                    layout="stacked"
                    align="start"
                    controlHeight="fill"
                    controlMinHeight="large"
                    motion="none"
                    type="button"
                    className="w-full min-w-0"
                    onClick={() => setShowAll(true)}
                  >
                    <span className="group/web-search flex h-full w-full min-w-0 flex-col justify-between gap-2">
                      <SiteStack sources={rest} load={near} />
                      <Text size="caption" weight="medium">
                        {t("{p0} more sources", { p0: format.formatNumber(rest.length) })}
                      </Text>
                    </span>
                  </Button>
                </li>
              ) : null}
            </ol>
          ) : null}
        </Disclosure>
      ) : (
        <>
          <Disclosure
            variant="step"
            collapsible={false}
            summaryLabel={query ? `${label}: ${query}` : label}
            summary={pill}
          />
          {working ? (
            <ol className={CARD_GRID} aria-hidden>
              {Array.from({ length: PLACEHOLDERS }, (_, index) => (
                <li
                  key={index}
                  {...surfaceAttributes(
                    { variant: "inset", radius: "control" },
                    "flex min-h-14 min-w-0 flex-col justify-between gap-1 p-2",
                  )}
                >
                  <SkeletonBar width="88%" />
                  <SkeletonBar width="60%" />
                  <SkeletonBar width="40%" height="0.5rem" className="mt-auto" />
                </li>
              ))}
            </ol>
          ) : null}
        </>
      )}
    </div>
  );
}
