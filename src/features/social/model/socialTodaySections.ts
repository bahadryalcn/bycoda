import type {
  SocialCampaign,
  SocialCollection,
  SocialContact,
  SocialJob,
  SocialSnapshot,
  SocialThread,
  SocialWorkspaceQuery,
} from "./social";
import { SOCIAL_COLLECTIONS } from "./social";

type Section = NonNullable<SocialWorkspaceQuery["section"]>;

/** Collections each section returns, mirroring the Host's section-scoped `workspace.snapshot`. */
const SECTION_COLLECTIONS: Partial<Record<Section, readonly SocialCollection[]>> = {
  campaigns: ["campaigns", "jobs"],
  inbox: ["threads", "contacts", "drafts", "jobs"],
  plans: ["publishingPlans", "campaigns", "jobs"],
  history: ["jobs", "campaigns", "contacts"],
};

const JOB_STATUSES: SocialJob["status"][] = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "review",
  "cancelled",
];

/** Newest first, like the Host's section pages; equal keys keep the Host's own order. */
function newestFirst<T>(rows: T[], at: (row: T) => number | undefined): T[] {
  return [...rows].sort((a, b) => (at(b) ?? 0) - (at(a) ?? 0));
}

/** Same rule as the Host's campaign state: review and failure lead, a pause beats queued work. */
function campaignState(campaign: SocialCampaign, counts: Partial<Record<string, number>>) {
  if (counts.review) return "review";
  if (counts.failed) return "failed";
  if (counts.running) return "running";
  if (campaign.paused) return "paused";
  if (counts.queued) return "queued";
  if (counts.succeeded) return counts.cancelled ? "partial" : "succeeded";
  return counts.cancelled ? "cancelled" : "draft";
}

/**
 * Narrows one full Host snapshot to what a section-scoped read returns, for a Host that cannot
 * answer `workspace.snapshot` with a `section`. The Host already limited the snapshot to what the
 * caller may see; this only narrows further (project, section, page size) and never widens it, so
 * results, project scope and visibility match the narrow path. Counts and campaign states come
 * from every visible job, not from the capped page.
 */
export function sectionFromFullSnapshot(
  full: SocialSnapshot,
  section: Section,
  projectId: string,
  limit: number,
): SocialSnapshot {
  const included = new Set(SECTION_COLLECTIONS[section] ?? []);
  const inProject = (projectIds: string[] | undefined) =>
    !projectId || !!projectIds?.includes(projectId);
  const visible = {
    campaigns: full.campaigns.filter((row) => inProject(row.projectIds)),
    publishingPlans: (full.publishingPlans ?? []).filter(
      (row) => !projectId || row.projectId === projectId,
    ),
    // A conversation not yet assigned to a project stays visible in every project, as on the Host.
    threads: full.threads.filter(
      (row) => !projectId || !row.projectId || row.projectId === projectId,
    ),
    contacts: full.contacts.filter((row) => inProject(row.projectIds)),
    rules: full.rules.filter((row) => !projectId || row.projectId === projectId),
    jobs: full.jobs.filter((row) => inProject(row.projectIds)),
    drafts: full.drafts.filter((row) => !projectId || row.projectId === projectId),
  };
  const ordered = {
    ...visible,
    campaigns: newestFirst(visible.campaigns, (row) => row.createdAt),
    publishingPlans: newestFirst(visible.publishingPlans, (row) => row.createdAt),
    threads: newestFirst(visible.threads, (row) => row.lastInboundAt),
    contacts: visible.contacts,
    jobs: newestFirst(visible.jobs, (row) => row.createdAt),
    drafts: newestFirst(visible.drafts, (row) => row.createdAt),
  };

  const jobCounts: NonNullable<SocialSnapshot["jobCounts"]> = {};
  const campaignJobCounts: NonNullable<SocialSnapshot["campaignJobCounts"]> = {};
  const perCampaign = new Map<string, Partial<Record<string, number>>>();
  for (const status of JOB_STATUSES) {
    jobCounts[status] = 0;
    campaignJobCounts[status] = 0;
  }
  for (const job of visible.jobs) {
    jobCounts[job.status] = (jobCounts[job.status] ?? 0) + 1;
    if (!job.campaignId) continue;
    campaignJobCounts[job.status] = (campaignJobCounts[job.status] ?? 0) + 1;
    const counts = perCampaign.get(job.campaignId) ?? {};
    counts[job.status] = (counts[job.status] ?? 0) + 1;
    perCampaign.set(job.campaignId, counts);
  }

  const page = <T>(collection: SocialCollection, rows: T[]): T[] =>
    included.has(collection) ? rows.slice(0, limit) : [];
  const campaigns = page("campaigns", ordered.campaigns);
  const publishingPlans = page("publishingPlans", ordered.publishingPlans);
  const threads = page("threads", ordered.threads);
  const contacts = page("contacts", ordered.contacts);
  const jobs = page("jobs", ordered.jobs);
  const drafts = page("drafts", ordered.drafts);

  const pages: NonNullable<SocialSnapshot["pages"]> = {};
  for (const collection of SOCIAL_COLLECTIONS)
    pages[collection] = { offset: 0, limit, total: visible[collection].length };

  // References the current pages need, taken from the full visible sets like the Host's `related`.
  const byId = <T extends { id: string }>(rows: T[], ids: (string | undefined)[]): T[] => {
    const wanted = new Set(ids.filter((id): id is string => !!id));
    return rows.filter((row) => wanted.has(row.id));
  };
  const related: NonNullable<SocialSnapshot["related"]> = {
    contacts: byId<SocialContact>(visible.contacts, [
      ...threads.map((row) => row.contactId),
      ...drafts.map((row) => row.contactId),
      ...jobs.map((row) => row.contactId),
    ]),
    campaigns: byId<SocialCampaign>(visible.campaigns, [
      ...jobs.map((row) => row.campaignId),
      ...publishingPlans.flatMap((row) => row.campaigns.map((entry) => entry.campaignId)),
    ]),
    jobs: byId<SocialJob>(
      visible.jobs,
      publishingPlans.flatMap((row) => [row.pendingJobId, row.lastJobId]),
    ),
    threads: byId<SocialThread>(
      visible.threads,
      drafts.map((row) => row.threadId),
    ),
  };

  const stateCampaigns = [
    ...new Map(
      [...campaigns, ...(related.campaigns ?? [])].map((campaign) => [campaign.id, campaign]),
    ).values(),
  ];
  const approved = new Set(full.approvedCampaignIds ?? []);
  return {
    ...full,
    campaigns,
    publishingPlans,
    threads,
    contacts,
    jobs,
    drafts,
    rules: [],
    segments: full.segments.filter((row) => inProject(row.projectIds)),
    profiles: full.profiles.filter((row) => !projectId || row.projectId === projectId),
    approvedCampaignIds: stateCampaigns.filter((row) => approved.has(row.id)).map((row) => row.id),
    pages,
    jobCounts,
    campaignJobCounts,
    campaignStates: Object.fromEntries(
      stateCampaigns.map((campaign) => [
        campaign.id,
        campaignState(campaign, perCampaign.get(campaign.id) ?? {}),
      ]),
    ),
    related,
    filters: {},
  };
}
