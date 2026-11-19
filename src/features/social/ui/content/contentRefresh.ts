import type { InfiniteData } from "@tanstack/react-query";
import { SOCIAL_COLLECTIONS, type SocialSnapshot, type SocialWorkspaceQuery } from "../../model/social";

export type Offsets = NonNullable<SocialWorkspaceQuery["offsets"]>;
/** One bounded Host page of the content list and the offsets it was read with. */
export type ContentPage = { snapshot: SocialSnapshot | undefined; offsets: Offsets };
export type ContentPages = InfiniteData<ContentPage, Offsets>;

/** The collections the content list pages through, newest first by creation, so new rows arrive on top. */
const PAGED = ["campaigns", "jobs"] as const;
type Related = NonNullable<SocialSnapshot["related"]>;
const RELATED = ["campaigns", "contacts", "jobs", "threads"] as const;
/** Page-scoped or per-collection fields; everything else on a snapshot is workspace-wide. */
const PAGE_OWNED = new Set<string>([
  ...SOCIAL_COLLECTIONS,
  "pages",
  "related",
  "campaignStates",
  "approvedCampaignIds",
]);

type Row = { id: string };
const idsOf = (rows: Row[]) => new Set(rows.map((row) => row.id));

/** Rows of every loaded page in list order, each once. */
function loadedRows(pages: ContentPage[], collection: (typeof PAGED)[number]): Row[] {
  const rows = new Map<string, Row>();
  for (const page of pages)
    for (const row of page.snapshot?.[collection] ?? []) if (!rows.has(row.id)) rows.set(row.id, row);
  return [...rows.values()];
}

/** Reference rows: the newest page's copies win, and later pages drop theirs so stale ones never override. */
function relatedOf(old: SocialSnapshot["related"], fresh: Related | undefined, withFresh: boolean) {
  const related: Partial<Record<(typeof RELATED)[number], Row[]>> = {};
  for (const key of RELATED) {
    const latest = (fresh?.[key] ?? []) as Row[];
    const latestIds = idsOf(latest);
    const older = ((old?.[key] ?? []) as Row[]).filter((row) => !latestIds.has(row.id));
    if (older.length || (withFresh && latest.length))
      related[key] = withFresh ? [...older, ...latest] : older;
  }
  return related as Related;
}

/**
 * Folds a freshly read newest page into the loaded pages. New and changed rows replace their copies;
 * loaded rows newer than the point where the new page overlaps them that it no longer lists were
 * deleted, so they go. Rows pushed past the first page by new ones stay in the first page, the later
 * pages keep their rows, and the next offset follows the list's change in size so continuing
 * neither skips nor repeats rows. Deletions below the overlap are not seen until the list is
 * refetched in full.
 *
 * When no loaded row is in the new page (more than a page of rows arrived) the rows between would be
 * missing, so the list restarts from the new page. A list that now fits in one page does the same.
 */
export function refreshContentPages(data: ContentPages, fresh: ContentPage): ContentPages {
  const latest = fresh.snapshot;
  if (!latest || !data.pages[0]?.snapshot) return data;
  const restart: ContentPages = { pages: [fresh], pageParams: data.pageParams.slice(0, 1) };
  if (data.pages.length === 1) return restart;

  /** Ids to remove from the older copies, for each collection with rows beyond the newest page. */
  const dropped: Partial<Record<(typeof PAGED)[number], Set<string>>> = {};
  for (const collection of PAGED) {
    const rows = latest[collection];
    const meta = latest.pages?.[collection];
    if (!meta || meta.offset + rows.length >= meta.total) continue;
    const latestIds = idsOf(rows);
    const loaded = loadedRows(data.pages, collection);
    let overlap = -1;
    loaded.forEach((row, index) => {
      if (latestIds.has(row.id)) overlap = index;
    });
    if (overlap < 0) return restart;
    dropped[collection] = new Set([
      ...latestIds,
      ...loaded.slice(0, overlap + 1).map((row) => row.id),
    ]);
  }

  /** The first page's rows: the newest ones, then the old first-page rows they pushed down. */
  const head = (collection: (typeof PAGED)[number]): Row[] => {
    const drop = dropped[collection];
    const old = (data.pages[0]!.snapshot![collection] ?? []) as Row[];
    return drop ? [...latest[collection], ...old.filter((row) => !drop.has(row.id))] : latest[collection];
  };
  const last = data.pages.length - 1;
  const pages = data.pages.map((page, index): ContentPage => {
    const old = page.snapshot;
    if (!old) return page;
    const next: Record<string, unknown> = index === 0 ? { ...latest } : { ...old };
    for (const collection of PAGED) {
      const drop = dropped[collection];
      if (index === 0 || !drop || (page.offsets[collection] ?? 0) <= 0)
        // A collection still at offset 0 is replaced wholesale when pages are combined.
        next[collection] = head(collection);
      else next[collection] = (old[collection] as Row[]).filter((row) => !drop.has(row.id));
    }
    next.related = relatedOf(old.related, latest.related, index === 0);
    if (index === last) {
      for (const [key, value] of Object.entries(latest)) if (!PAGE_OWNED.has(key)) next[key] = value;
      next.campaignStates = { ...old.campaignStates, ...latest.campaignStates };
      next.approvedCampaignIds = [
        ...new Set([...(old.approvedCampaignIds ?? []), ...(latest.approvedCampaignIds ?? [])]),
      ];
      const meta: NonNullable<SocialSnapshot["pages"]> = { ...latest.pages };
      for (const collection of PAGED) {
        const fresher = latest.pages?.[collection];
        const was = old.pages?.[collection];
        if (fresher && was && dropped[collection] && (page.offsets[collection] ?? 0) > 0)
          // The cursor keeps its place among the rows: it moves with the list's net growth.
          meta[collection] = {
            ...was,
            total: fresher.total,
            offset: Math.max(0, was.offset + fresher.total - was.total),
          };
      }
      next.pages = meta;
    }
    return { ...page, snapshot: next as SocialSnapshot };
  });
  return { pages, pageParams: data.pageParams };
}
