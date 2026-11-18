import { SocialPlatformError, type SocialAccount, type SocialHttp } from "../adapter";

export type LinkedInAnalyticsQuery = {
  kind: "posts" | "profile" | "page" | "followers";
  postId?: string;
};

const FOLLOWER_FACETS = [
  ["associationType", "associationType", "followerCountsByAssociationType"],
  ["geoCountry", "geo", "followerCountsByGeoCountry"],
  ["function", "function", "followerCountsByFunction"],
  ["industry", "industry", "followerCountsByIndustry"],
  ["geo", "geo", "followerCountsByGeo"],
  ["seniority", "seniority", "followerCountsBySeniority"],
  ["staffCountRange", "staffCountRange", "followerCountsByStaffCountRange"],
] as const;

export type LinkedInAnalyticsResult = {
  source: "api" | "browser";
  metrics: Record<string, number>;
  followerBreakdowns?: {
    kind: (typeof FOLLOWER_FACETS)[number][0];
    values: { id: string; followers: number }[];
  }[];
};

type AnalyticsAccount = Pick<SocialAccount, "platform" | "accountType" | "platformId"> & {
  scopes: readonly string[];
};

type LinkedInRead = (path: string) => Promise<Record<string, unknown>>;

const MEMBER_POST_METRICS = [
  ["impressions", "IMPRESSION"],
  ["membersReached", "MEMBERS_REACHED"],
  ["reshares", "RESHARE"],
  ["reactions", "REACTION"],
  ["comments", "COMMENT"],
] as const;

const MEMBER_EXTENDED_METRICS = [
  ["postSaves", "POST_SAVE"],
  ["postSends", "POST_SEND"],
  ["linkClicks", "LINK_CLICKS"],
  ["premiumCtaClicks", "PREMIUM_CTA_CLICKS"],
  ["followersFromContent", "FOLLOWER_GAINED_FROM_CONTENT"],
  ["profileViewsFromContent", "PROFILE_VIEW_FROM_CONTENT"],
] as const;

const ORGANIZATION_POST_FIELDS = [
  ["impressions", "impressionCount"],
  ["membersReached", "uniqueImpressionsCount"],
  ["reshares", "shareCount"],
  ["likes", "likeCount"],
  ["comments", "commentCount"],
  ["clicks", "clickCount"],
  ["engagementRate", "engagement"],
] as const;

const analyticsAccessError = () =>
  new SocialPlatformError("denied", undefined, { reasonCode: "linkedin.analytics.access" });

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SocialPlatformError("unknown");
  return value as Record<string, unknown>;
}

function totalRow(value: Record<string, unknown>) {
  // The aggregate finders request a single unpaginated total. An empty result means no data.
  const elements = value.elements;
  if (!Array.isArray(elements) || elements.length > 1) throw new SocialPlatformError("unknown");
  return elements.length ? record(elements[0]) : undefined;
}

function count(value: unknown, canBeNegative = false): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || (!canBeNegative && value < 0))
    throw new SocialPlatformError("unknown");
  return value;
}

function readOrganizationId(account: AnalyticsAccount): string {
  const numeric = /^(?:urn:li:organization:)?([1-9]\d{0,24})$/.exec(account.platformId)?.[1];
  if (!numeric) throw new SocialPlatformError("denied");
  return `urn:li:organization:${numeric}`;
}

async function readMemberPosts(get: LinkedInRead, version: string, postId?: string) {
  const unionKey = postId?.startsWith("urn:li:share:") ? "share" : "ugc";
  const finder = postId ? `q=entity&entity=(${unionKey}:${encodeURIComponent(postId)})` : "q=me";
  const metrics =
    version >= "202604"
      ? [...MEMBER_POST_METRICS, ...MEMBER_EXTENDED_METRICS]
      : MEMBER_POST_METRICS;
  const result: Record<string, number> = {};
  for (const [name, type] of metrics) {
    const row = totalRow(
      await get(`/rest/memberCreatorPostAnalytics?${finder}&queryType=${type}&aggregation=TOTAL`),
    );
    if (!row) continue;
    // The API uses a typed union wrapper before version 202605 and a string after it.
    const metric =
      typeof row.metricType === "string"
        ? row.metricType
        : record(row.metricType)[
            "com.linkedin.adsexternalapi.memberanalytics.v1.CreatorPostAnalyticsMetricTypeV1"
          ];
    if (metric !== type || (postId && record(row.targetEntity)[unionKey] !== postId))
      throw new SocialPlatformError("unknown");
    result[name] = count(row.count);
  }
  return result;
}

async function readOrganizationPosts(get: LinkedInRead, organization: string, postId?: string) {
  const target = postId?.startsWith("urn:li:share:") ? "share" : "ugcPost";
  const postFilter = postId
    ? target === "share"
      ? `&shares=List(${encodeURIComponent(postId)})`
      : `&ugcPosts%5B0%5D=${encodeURIComponent(postId)}`
    : "";
  const row = totalRow(
    await get(
      `/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(organization)}${postFilter}`,
    ),
  );
  if (!row) return {};
  if (row.organizationalEntity !== organization || (postId && row[target] !== postId))
    throw new SocialPlatformError("unknown");
  const totals = record(row.totalShareStatistics);
  const result: Record<string, number> = {};
  for (const [name, key] of ORGANIZATION_POST_FIELDS) {
    const value =
      totals[key] ??
      (key === "uniqueImpressionsCount" ? totals.uniqueImpressionsCounts : undefined);
    if (value === undefined) continue;
    if (key === "engagement") {
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new SocialPlatformError("unknown");
      result[name] = value;
    } else {
      // LinkedIn can report negative organic like totals after a promoted post is unliked.
      result[name] = count(value, key === "likeCount");
    }
  }
  return result;
}

async function readOrganizationPage(get: LinkedInRead, organization: string) {
  const row = totalRow(
    await get(
      `/rest/organizationPageStatistics?q=organization&organization=${encodeURIComponent(organization)}`,
    ),
  );
  if (!row) return {};
  if (row.organization !== organization) throw new SocialPlatformError("unknown");
  const totals = record(record(record(row.totalPageStatistics).views).allPageViews);
  return {
    pageViews: count(totals.pageViews),
    ...(totals.uniquePageViews !== undefined
      ? { uniquePageViews: count(totals.uniquePageViews) }
      : {}),
  };
}

async function readOrganizationFollowers(
  get: LinkedInRead,
  organization: string,
): Promise<LinkedInAnalyticsResult> {
  const encoded = encodeURIComponent(organization);
  const size = await get(`/v2/networkSizes/${encoded}?edgeType=CompanyFollowedByMember`);
  const metrics = { followers: count(size.firstDegreeSize) };
  const row = totalRow(
    await get(
      `/rest/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${encoded}`,
    ),
  );
  const followerBreakdowns: NonNullable<LinkedInAnalyticsResult["followerBreakdowns"]> = [];
  if (row) {
    if (row.organizationalEntity !== organization) throw new SocialPlatformError("unknown");
    for (const [kind, key, field] of FOLLOWER_FACETS) {
      const items = row[field];
      if (items === undefined) continue;
      if (!Array.isArray(items) || items.length > 100) throw new SocialPlatformError("unknown");
      const values = items.map((item: unknown) => {
        const entry = record(item);
        const id = entry[key];
        if (typeof id !== "string" || !/^[\w:-]{1,125}$/.test(id))
          throw new SocialPlatformError("unknown");
        // In lifetime facets the API combines organic and paid in this field despite its name.
        return { id, followers: count(record(entry.followerCounts).organicFollowerCount) };
      });
      if (values.length) followerBreakdowns.push({ kind, values });
    }
  }
  return { source: "api", metrics, ...(followerBreakdowns.length ? { followerBreakdowns } : {}) };
}

/** Official reporting APIs, scoped to the authenticated member or the connected Page. */
export async function readLinkedInAnalytics(
  http: SocialHttp,
  linkedinVersion: string,
  account: AnalyticsAccount,
  token: string,
  query: LinkedInAnalyticsQuery,
): Promise<LinkedInAnalyticsResult> {
  if (account.platform !== "linkedin" || !/^20\d{2}(?:0[1-9]|1[0-2])$/.test(linkedinVersion))
    throw new SocialPlatformError("unsupported");
  if (
    query.postId !== undefined &&
    (query.kind !== "posts" || !/^urn:li:(?:share|ugcPost):[1-9]\d{0,24}$/.test(query.postId))
  )
    throw new SocialPlatformError("rejected");
  if (query.kind === "profile") throw new SocialPlatformError("unsupported");

  const get: LinkedInRead = async (path) => {
    try {
      const { value } = await http.request(`https://api.linkedin.com${path}`, token, {
        headers: { "LinkedIn-Version": linkedinVersion, "X-Restli-Protocol-Version": "2.0.0" },
      });
      return record(value);
    } catch (error) {
      if (error instanceof SocialPlatformError && error.code === "denied")
        throw analyticsAccessError();
      throw error;
    }
  };
  if (account.accountType === "organization") {
    if (!account.scopes.includes("rw_organization_admin")) throw analyticsAccessError();
    const organization = readOrganizationId(account);
    if (query.kind === "posts")
      return {
        source: "api",
        metrics: await readOrganizationPosts(get, organization, query.postId),
      };
    if (query.kind === "page")
      return { source: "api", metrics: await readOrganizationPage(get, organization) };
    if (query.kind === "followers") return readOrganizationFollowers(get, organization);
  }
  if (account.accountType === "member") {
    if (query.kind === "posts") {
      if (!account.scopes.includes("r_member_postAnalytics")) throw analyticsAccessError();
      return { source: "api", metrics: await readMemberPosts(get, linkedinVersion, query.postId) };
    }
    if (query.kind === "followers") {
      if (!account.scopes.includes("r_member_profileAnalytics")) throw analyticsAccessError();
      const row = totalRow(await get("/rest/memberFollowersCount?q=me"));
      const metrics: Record<string, number> = row
        ? { followers: count(row.memberFollowersCount) }
        : {};
      return { source: "api", metrics };
    }
  }
  throw new SocialPlatformError("unsupported");
}
