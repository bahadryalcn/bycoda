import { expect, it } from "vitest";
import type { SocialSnapshot } from "../../model/social";
import { appendSocialWorkspacePage } from "../../model/socialWorkspace";
import { refreshContentPages, type ContentPage, type ContentPages } from "./contentRefresh";
import { nextContentOffsets } from "./useContentData";

const LIMIT = 3;

/** One Host page: `campaigns` are newest-first rows of a list of `total`; jobs stay one small page. */
function snapshot(
  campaigns: string[],
  total: number,
  offset: number,
  extra: Record<string, unknown> = {},
): SocialSnapshot {
  return {
    campaigns: campaigns.map((id) => ({ id })),
    jobs: [{ id: "j1" }, { id: "j2" }],
    accounts: [],
    stopped: false,
    campaignStates: Object.fromEntries(campaigns.map((id) => [id, "draft"])),
    related: { campaigns: [], jobs: [] },
    pages: {
      campaigns: { offset, limit: LIMIT, total },
      jobs: { offset: 0, limit: LIMIT, total: 2 },
    },
    ...extra,
  } as unknown as SocialSnapshot;
}
const first = (
  campaigns: string[],
  total: number,
  extra?: Record<string, unknown>,
): ContentPage => ({
  snapshot: snapshot(campaigns, total, 0, extra),
  offsets: {},
});
/** The second page was read at campaign offset 3 (jobs never advanced). */
const second = (campaigns: string[], total: number): ContentPage => ({
  snapshot: snapshot(campaigns, total, 3),
  offsets: { campaigns: 3, jobs: 0 },
});
/** c8..c3 loaded over two pages of a list of 8 (c8 newest). */
function loaded(): ContentPages {
  return {
    pages: [first(["c8", "c7", "c6"], 8), second(["c5", "c4", "c3"], 8)],
    pageParams: [{}, { campaigns: 3, jobs: 0 }],
  };
}
const rows = (page: ContentPage | undefined) => page?.snapshot?.campaigns.map((row) => row.id);

it("keeps loaded pages and moves the cursor with the list when a row arrives on top", () => {
  const next = refreshContentPages(loaded(), first(["c9", "c8", "c7"], 9));
  expect(rows(next.pages[0])).toEqual(["c9", "c8", "c7", "c6"]);
  expect(rows(next.pages[1])).toEqual(["c5", "c4", "c3"]);
  expect(next.pageParams).toEqual([{}, { campaigns: 3, jobs: 0 }]);
  const last = next.pages[1]?.snapshot;
  expect(last?.pages?.campaigns).toEqual({ offset: 4, limit: LIMIT, total: 9 });
  // c9..c3 are loaded, so the next read starts right after c3 (position 7).
  expect(nextContentOffsets(last)?.campaigns).toBe(7);
});

it("drops a deleted row seen in the newest page and does not skip a row when continuing", () => {
  const next = refreshContentPages(loaded(), first(["c8", "c6", "c5"], 7));
  expect(rows(next.pages[0])).toEqual(["c8", "c6", "c5"]);
  expect(rows(next.pages[1])).toEqual(["c4", "c3"]);
  const last = next.pages[1]?.snapshot;
  expect(last?.pages?.campaigns).toEqual({ offset: 2, limit: LIMIT, total: 7 });
  // c8 c6 c5 c4 c3 are loaded; the next read starts at position 5 (c2).
  expect(nextContentOffsets(last)?.campaigns).toBe(5);
});

it("combines to unique rows with the fresh copy of a changed row", () => {
  const data = loaded();
  const fresh = first(["c8", "c7", "c6"], 8);
  fresh.snapshot!.campaigns[1] = { id: "c7", name: "Renamed" } as never;
  const next = refreshContentPages(data, fresh);
  let combined: SocialSnapshot | undefined;
  for (const page of next.pages)
    combined = appendSocialWorkspacePage(combined, page.snapshot!, page.offsets);
  expect(combined?.campaigns.map((row) => row.id)).toEqual(["c8", "c7", "c6", "c5", "c4", "c3"]);
  expect((combined?.campaigns[1] as { name?: string }).name).toBe("Renamed");
});

it("takes workspace-wide fields and campaign states from the newest page onto the page that wins", () => {
  const next = refreshContentPages(loaded(), first(["c8", "c7", "c6"], 8, { stopped: true }));
  const last = next.pages[1]?.snapshot;
  expect(last?.stopped).toBe(true);
  expect(Object.keys(last?.campaignStates ?? {}).sort()).toEqual([
    "c3",
    "c4",
    "c5",
    "c6",
    "c7",
    "c8",
  ]);
});

it("restarts from the newest page when none of the loaded rows is in it", () => {
  const fresh = first(["c20", "c19", "c18"], 20);
  const next = refreshContentPages(loaded(), fresh);
  expect(next.pages).toEqual([fresh]);
  expect(next.pageParams).toEqual([{}]);
});

it("replaces a single loaded page and a collection that now fits in one page", () => {
  const fresh = first(["c9", "c8", "c7"], 9);
  const single: ContentPages = { pages: [first(["c8", "c7", "c6"], 8)], pageParams: [{}] };
  expect(refreshContentPages(single, fresh).pages).toEqual([fresh]);
  // Jobs fit in one page: the later page repeats the newest page's job rows, as the Host would.
  const data = loaded();
  data.pages[1]!.snapshot!.jobs = [{ id: "stale" }] as never;
  const next = refreshContentPages(data, first(["c9", "c8", "c7"], 9));
  expect(next.pages[1]?.snapshot?.jobs.map((row) => row.id)).toEqual(["j1", "j2"]);
});
