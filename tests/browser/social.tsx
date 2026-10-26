import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ToolPanel } from "../../src/app/shell/ToolNavigation";
import { SocialView } from "../../src/features/social/ui/SocialView";
import { XMediaFields } from "../../src/features/social/ui/XMediaFields";
import type { SocialClient } from "../../src/features/social/model/socialClient";
import type {
  SocialMedia,
  SocialTelegramChannelReview,
} from "../../src/features/social/model/social";
import type {
  SocialRegistrationProfile,
  SocialRegistrationProgress,
  SocialRegistrationReview,
} from "../../src/features/social/model/socialBrowser";
import { accountCapabilities, X_BROWSER_SCOPES } from "../../src/integrations/social/capabilities";
import { browserScopes } from "../../src/integrations/social/browserCapabilities";
import { contentSupport } from "../../src/integrations/social/platformAdapters";
import {
  SOCIAL_ACCOUNT_TYPES,
  SOCIAL_API_ACCOUNT_TYPES,
  SOCIAL_BROWSER_ACCOUNT_TYPES,
} from "../../src/features/social/model/social";
import {
  SOCIAL_COLLECTIONS,
  type SocialCollection,
  type SocialSnapshot,
  type SocialWorkspaceQuery,
  type SocialWorkspaceResponse,
} from "../../src/features/social/model/social";
import "../../src/styles/index.css";
import type { SocialProgram } from "../../src/features/social/model/socialProgram";
const programFixture = new URLSearchParams(location.search).has("programs");
const telegramChannelFixture = new URLSearchParams(location.search).has("telegram-channel");
const programRecords: SocialProgram[] = [];
const browserWorkflows: import("../../src/features/social/model/socialBrowser").SocialBrowserWorkflow[] =
  [];

function fixtureRegistrationProgress(
  platform: string,
  profile: SocialRegistrationProfile,
): SocialRegistrationProgress {
  const fields: ("email" | "birthdate")[] =
    platform === "tiktok" ? ["email", "birthdate"] : ["email"];
  const missing = fields.filter((field) => !profile[field]);
  return {
    status: missing.length ? "needs_fields" : "awaiting_owner",
    step: missing.length ? "profile" : "verification",
    blockers: missing.length ? [] : ["verification"],
    requiredFields: missing,
    filledFields: fields.filter((field) => !!profile[field]),
    canAdvance: false,
    message: missing.length
      ? "Provide the missing nonsecret owner registration fields."
      : "This step requires a password, verification or agreement action in the platform window. Resume afterwards; registration remains unverified.",
  };
}

// Deterministic host bridge: never reads live social accounts or sends content.
const snapshot: SocialSnapshot = {
  programsSupported: programFixture,
  executorId: "fixture",
  hostOnline: true,
  sendingEnabled: false,
  stopped: false,
  pollingEnabled: false,
  accounts: [
    {
      id: "x",
      platform: "x",
      platformId: "",
      name: "Demo account",
      accountType: "member",
      scopes: [],
      connected: false,
      accessApproved: false,
      paused: false,
      executorId: "fixture",
      grants: { demo: ["read", "draft"] },
      createdAt: 1,
    },
  ],
  campaigns: [],
  contacts: [],
  threads: [],
  segments: [],
  rules: [],
  jobs: [],
  drafts: [],
  profiles: [],
  capabilities: {
    x: [
      {
        operation: "publish",
        status: "pending",
        reason: "Authorization is required.",
        scopes: [],
        source: "https://docs.x.com",
      },
    ],
  },
  publishingPlans: [],
  approvedCampaignIds: [],
};
const calls: { command: string; args: Record<string, unknown> }[] = [];
let heldAction: string | undefined;
let releaseAction: ((reject: boolean) => void) | undefined;
let configured = false;
let oauthStatus = "idle";
let browserWrites = false;
const browserFlows: Record<string, { status: "waiting" | "connected"; expiresAt?: number }> = {};
const mediaUploads = new Map<
  string,
  { kind: SocialMedia["kind"]; offset: number; base64?: string }
>();
let xProfileFixture = {
  name: "bycoda",
  bio: "Fixture bio",
  location: "",
  website: "https://example.test",
};
const pageProfileFixtures = new Map<string, typeof xProfileFixture>();
const finalRegistrationReviews = new Map<string, SocialRegistrationReview>();
const telegramChannelReviews = new Map<string, SocialTelegramChannelReview>();
if (telegramChannelFixture) {
  browserWrites = true;
  configured = true;
  snapshot.sendingEnabled = true;
  snapshot.accounts = [
    {
      id: "telegram-channel",
      platform: "telegram",
      platformId: "",
      name: "Fixture Telegram channel",
      accountType: "channel",
      connection: "token",
      scopes: [],
      connected: false,
      accessApproved: false,
      paused: false,
      executorId: "fixture",
      grants: { demo: ["read", "draft", "publish"] },
      createdAt: 1,
    },
  ];
  snapshot.capabilities = { "telegram-channel": accountCapabilities(snapshot.accounts[0]) };
  snapshot.policies = { global: {}, platforms: {} };
}
if (new URLSearchParams(location.search).has("linkedin-final-review")) {
  browserWrites = true;
  snapshot.accounts = [
    {
      ...snapshot.accounts[0],
      id: "linkedin-final",
      platform: "linkedin",
      name: "Fixture LinkedIn final Page",
      accountType: "organization",
      connection: "browser",
      connected: false,
      accessApproved: true,
    },
  ];
  browserWorkflows.push({
    id: "fixture-final-workflow",
    accountId: "linkedin-final",
    platform: "linkedin",
    intent: "signup",
    status: "awaiting_owner",
    createdAt: 1,
    updatedAt: 2,
    expiresAt: Date.now() + 1200000,
    outcome: "unverified",
    registration: {
      status: "awaiting_owner",
      step: "terms",
      blockers: ["terms"],
      requiredFields: [],
      filledFields: ["displayName", "username", "category"],
      canAdvance: false,
      message: "Review the observed final Page form before creating it.",
    },
  });
}
if (new URLSearchParams(location.search).has("instagram-profile")) {
  browserWrites = true;
  snapshot.accounts = ["one", "two"].map((suffix) => ({
    ...snapshot.accounts[0],
    id: `instagram-${suffix}`,
    platform: "instagram",
    platformId: `web:instagram:fixture_${suffix}`,
    name: `Fixture Instagram ${suffix}`,
    accountType: "member",
    connection: "browser",
    scopes: browserScopes("instagram"),
    connected: true,
    accessApproved: true,
  }));
  snapshot.accounts.forEach((account) => {
    snapshot.capabilities[account.id] = accountCapabilities(account);
    pageProfileFixtures.set(account.id, {
      name: account.name,
      bio: "Fixture Instagram bio",
      location: "",
      website: "",
    });
  });
}
if (new URLSearchParams(location.search).has("facebook-profile")) {
  browserWrites = true;
  snapshot.accounts = ["one", "two"].map((suffix) => ({
    ...snapshot.accounts[0],
    id: `facebook-page-${suffix}`,
    platform: "facebook",
    platformId: `web:facebook:${suffix === "one" ? "123" : "456"}`,
    name: `Fixture Facebook Page ${suffix}`,
    accountType: "page",
    connection: "browser",
    scopes: browserScopes("facebook"),
    connected: true,
    accessApproved: true,
  }));
  snapshot.accounts.forEach((account) => {
    snapshot.capabilities[account.id] = accountCapabilities(account);
    pageProfileFixtures.set(account.id, { name: account.name, bio: "", location: "", website: "" });
  });
}
if (new URLSearchParams(location.search).has("linkedin-profile")) {
  browserWrites = true;
  snapshot.accounts = ["one", "two"].map((suffix) => ({
    ...snapshot.accounts[0],
    id: `linkedin-page-${suffix}`,
    platform: "linkedin",
    platformId: `web:linkedin:company:${suffix === "one" ? "123" : "456"}`,
    name: `Fixture LinkedIn Page ${suffix}`,
    accountType: "organization",
    connection: "browser",
    scopes: browserScopes("linkedin"),
    connected: true,
    accessApproved: true,
  }));
  snapshot.accounts.forEach((account) => {
    snapshot.capabilities[account.id] = accountCapabilities(account);
    pageProfileFixtures.set(account.id, {
      name: account.name,
      bio: "Fixture Page tagline",
      location: "",
      website: "",
    });
  });
}
if (new URLSearchParams(location.search).has("browser-monitor")) {
  snapshot.accounts[0].connected = true;
  snapshot.accounts[0].connection = "browser";
  snapshot.accounts[0].accessApproved = true;
  snapshot.accounts[0].platformId = "42";
  snapshot.accounts[0].scopes = [...X_BROWSER_SCOPES];
  snapshot.capabilities.x = accountCapabilities(snapshot.accounts[0]);
}
if (new URLSearchParams(location.search).has("tiktok")) {
  snapshot.accounts.push({
    id: "tiktok",
    platform: "tiktok",
    platformId: "creator",
    name: "Demo TikTok",
    accountType: "member",
    scopes: ["user.info.basic", "video.publish"],
    connected: true,
    accessApproved: true,
    paused: false,
    executorId: "fixture",
    grants: { demo: ["read", "draft", "publish"] },
    createdAt: 1,
  });
  snapshot.capabilities.tiktok = accountCapabilities(
    snapshot.accounts[snapshot.accounts.length - 1],
  );
}
let projects = [{ id: "demo", cwd: "/demo", name: "Demo project" }];
let workflowWrites = false;
function fixtureCampaignState(campaign: SocialSnapshot["campaigns"][number]) {
  const jobs = snapshot.jobs.filter((job) => job.campaignId === campaign.id);
  for (const status of ["review", "failed", "running"] as const)
    if (jobs.some((job) => job.status === status)) return status;
  if (campaign.paused) return "paused";
  if (jobs.some((job) => job.status === "queued")) return "queued";
  if (jobs.some((job) => job.status === "succeeded"))
    return jobs.every((job) => job.status === "succeeded") ? "succeeded" : "partial";
  return jobs.length ? "cancelled" : "draft";
}
function fixtureWorkspace(input: SocialWorkspaceQuery): SocialWorkspaceResponse {
  const { cursor: previous, ...query } = input;
  let signature = 2166136261;
  for (const character of JSON.stringify([snapshot, query]))
    signature = Math.imul(signature ^ character.charCodeAt(0), 16777619);
  const cursor = `fixture-${signature >>> 0}`;
  if (previous === cursor) return { cursor, unchanged: true };
  const limit = input.limit ?? 50;
  const sections: Record<string, readonly SocialCollection[]> = {
    accounts: [],
    campaigns: ["campaigns", "jobs"],
    inbox: ["threads", "contacts", "drafts", "jobs"],
    audience: ["contacts", "threads", "drafts", "jobs"],
    plans: ["publishingPlans", "campaigns", "jobs"],
    rules: ["rules", "drafts", "jobs"],
    history: ["jobs", "campaigns", "contacts"],
    sending: [],
    settings: [],
  };
  const section = sections[input.section ?? "accounts"];
  const result = structuredClone(snapshot);
  result.pages = {};
  result.related = {};
  result.filters = {};
  result.jobCounts = {};
  result.campaignJobCounts = {};
  result.campaignStates = Object.fromEntries(
    snapshot.campaigns.map((campaign) => [campaign.id, fixtureCampaignState(campaign)]),
  );
  const inProject = (
    row: { projectIds?: string[]; projectId?: string },
    collection: SocialCollection,
  ) =>
    !input.projectId ||
    (collection === "threads"
      ? !row.projectId || row.projectId === input.projectId
      : row.projectIds
        ? row.projectIds.includes(input.projectId)
        : row.projectId === input.projectId);
  for (const job of snapshot.jobs.filter((job) => inProject(job, "jobs"))) {
    result.jobCounts[job.status] = (result.jobCounts[job.status] ?? 0) + 1;
    if (job.campaignId)
      result.campaignJobCounts[job.status] = (result.campaignJobCounts[job.status] ?? 0) + 1;
  }
  for (const collection of SOCIAL_COLLECTIONS) {
    const filter = Object.fromEntries(
      Object.entries(input.filters?.[collection] ?? {})
        .filter(([, value]) => value !== undefined && value !== "")
        .map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]),
    );
    result.filters[collection] = filter;
    const rows = (snapshot[collection] ?? [])
      .filter((row) => {
        if (!inProject(row as { projectIds?: string[]; projectId?: string }, collection))
          return false;
        const value = row as unknown as Record<string, unknown>;
        if (filter.accountId && value.accountId !== filter.accountId) return false;
        if (filter.kind && value.kind !== filter.kind) return false;
        if (filter.since !== undefined && Number(value.createdAt) < Number(filter.since))
          return false;
        if (
          filter.status &&
          (collection === "campaigns" ? result.campaignStates?.[row.id] : value.status) !==
            filter.status
        )
          return false;
        if (filter.segmentId && collection === "contacts") {
          const contact = row as SocialSnapshot["contacts"][number];
          const segment = snapshot.segments.find((item) => item.id === filter.segmentId)!;
          if (
            (segment.language && segment.language !== contact.language) ||
            !segment.tags.every((tag) => contact.tags.includes(tag)) ||
            !segment.projectIds.some((id) => contact.projectIds.includes(id))
          )
            return false;
        }
        if (filter.query) {
          let text = String(value.name ?? "");
          if (collection === "threads") {
            const thread = row as SocialSnapshot["threads"][number];
            text = `${snapshot.contacts.find((item) => item.id === thread.contactId)?.name ?? ""} ${thread.events[thread.events.length - 1]?.text ?? ""}`;
          } else if (collection === "contacts") {
            const contact = row as SocialSnapshot["contacts"][number];
            text = `${contact.name} ${contact.platformId} ${contact.tags.join(" ")}`;
          } else if (collection === "jobs") {
            const job = row as SocialSnapshot["jobs"][number];
            text = `${snapshot.accounts.find((item) => item.id === job.accountId)?.name ?? ""} ${snapshot.campaigns.find((item) => item.id === job.campaignId)?.name ?? ""} ${snapshot.contacts.find((item) => item.id === job.contactId)?.name ?? ""} ${job.payload.text} ${job.error ?? ""}`;
          }
          const language = collection === "contacts" ? "en" : "tr";
          if (
            !text
              .toLocaleLowerCase(language)
              .includes(String(filter.query).toLocaleLowerCase(language))
          )
            return false;
        }
        return true;
      })
      .sort((first, second) => {
        if (collection === "threads")
          return (
            (second as SocialSnapshot["threads"][number]).lastInboundAt -
            (first as SocialSnapshot["threads"][number]).lastInboundAt
          );
        if (collection === "jobs")
          return (
            (second as SocialSnapshot["jobs"][number]).createdAt -
            (first as SocialSnapshot["jobs"][number]).createdAt
          );
        return (
          (snapshot[collection] ?? []).indexOf(second as never) -
          (snapshot[collection] ?? []).indexOf(first as never)
        );
      });
    const offset = Math.min(
      input.offsets?.[collection] ?? 0,
      Math.max(0, Math.ceil(rows.length / limit) - 1) * limit,
    );
    result.pages[collection] = { offset, limit, total: rows.length };
    Object.assign(result, {
      [collection]: section.includes(collection)
        ? structuredClone(rows.slice(offset, offset + limit))
        : [],
    });
  }
  const threads = [
    ...result.threads,
    ...snapshot.threads.filter((thread) =>
      result.drafts.some((draft) => draft.threadId === thread.id),
    ),
  ];
  result.related.contacts = structuredClone(
    snapshot.contacts.filter(
      (contact) =>
        threads.some((thread) => thread.contactId === contact.id) ||
        result.drafts.some((draft) => draft.contactId === contact.id) ||
        result.jobs.some((job) => job.contactId === contact.id),
    ),
  );
  result.related.campaigns = structuredClone(
    snapshot.campaigns.filter(
      (campaign) =>
        result.jobs.some((job) => job.campaignId === campaign.id) ||
        result.publishingPlans?.some((plan) =>
          plan.campaigns.some((item) => item.campaignId === campaign.id),
        ),
    ),
  );
  result.related.jobs = structuredClone(
    snapshot.jobs.filter(
      (job) =>
        result.drafts.some((draft) => draft.id === job.draftId && job.status !== "cancelled") ||
        result.publishingPlans?.some(
          (plan) => plan.pendingJobId === job.id || plan.lastJobId === job.id,
        ),
    ),
  );
  result.related.threads = structuredClone(
    threads.filter((thread) => !result.threads.some((item) => item.id === thread.id)),
  );
  for (const thread of [...result.threads, ...result.related.threads]) {
    const total = thread.events.length;
    thread.hasInbound = thread.events.some((event) => event.direction === "inbound");
    thread.events = thread.events
      .slice(-1)
      .map((event) => ({ ...event, text: event.text.slice(0, 300) }));
    thread.eventsPreview = true;
    thread.eventsPage = { offset: Math.max(0, total - 1), limit: 1, total };
  }
  for (const contact of [...result.contacts, ...result.related.contacts]) {
    const total = contact.history.length;
    contact.history = contact.history.slice(-5);
    contact.historyPage = { offset: Math.max(0, total - 5), limit: 5, total };
  }
  return { cursor, unchanged: false, snapshot: result };
}
Object.assign(window, {
  socialFixtureCalls: calls,
  socialFixtureState: () => structuredClone(snapshot),
  socialFixtureWorkflowState: () => structuredClone(browserWorkflows),
  socialFixtureChangeFinalRegistration: () => {
    const workflow = browserWorkflows.find((item) => item.id === "fixture-final-workflow");
    if (workflow) workflow.updatedAt++;
  },
  socialFixtureSeedRegistration: () => {
    browserWrites = true;
    browserWorkflows.splice(0);
    snapshot.accounts = [
      {
        ...snapshot.accounts[0],
        id: "registration-tiktok",
        platform: "tiktok",
        platformId: "",
        name: "Fixture registration TikTok",
        accountType: "member",
        connection: "browser",
        scopes: [],
        connected: false,
        accessApproved: false,
      },
      {
        ...snapshot.accounts[0],
        id: "existing-linkedin",
        platform: "linkedin",
        platformId: "web:linkedin:in:fixture-existing-member",
        name: "Fixture already connected LinkedIn",
        accountType: "member",
        connection: "browser",
        scopes: browserScopes("linkedin"),
        connected: true,
        accessApproved: true,
      },
    ] as SocialSnapshot["accounts"];
    snapshot.capabilities = Object.fromEntries(
      snapshot.accounts.map((account) => [account.id, accountCapabilities(account)]),
    );
  },
  socialFixtureBrowserMode: () => {
    browserWrites = true;
  },
  socialFixtureVerifyBrowser: (accountId: string) => {
    if (browserFlows[accountId]?.status !== "waiting")
      throw new Error("Fixture login is not awaiting owner verification.");
    const account = snapshot.accounts.find((item) => item.id === accountId)!;
    account.connected = true;
    account.accessApproved = true;
    account.connection = "browser";
    account.platformId = `web:${account.platform}:${account.platform === "telegram" ? "+905551234567" : "bycoda"}`;
    account.scopes =
      account.platform === "x" ? [...X_BROWSER_SCOPES] : browserScopes(account.platform);
    snapshot.capabilities[accountId] = accountCapabilities(account);
    browserFlows[accountId] = { status: "connected" };
  },
  socialFixtureSeedBrowser: () => {
    browserWrites = true;
    snapshot.sendingEnabled = true;
    snapshot.accounts = (["instagram", "telegram"] as const).map<
      SocialSnapshot["accounts"][number]
    >((platform) => ({
      id: platform,
      platform,
      platformId: `web:${platform}:${platform === "telegram" ? "+905551234567" : "bycoda"}`,
      name: platform === "telegram" ? "Bycoda Telegram" : "Bycoda Instagram",
      accountType: platform === "telegram" ? "member" : "professional",
      scopes: browserScopes(platform),
      connection: "browser",
      connected: true,
      accessApproved: true,
      paused: false,
      executorId: "fixture",
      grants: { demo: ["read", "draft", "publish", "reply", "message", "comment"] },
      createdAt: 1,
    }));
    snapshot.capabilities = Object.fromEntries(
      snapshot.accounts.map((account) => [account.id, accountCapabilities(account)]),
    );
    snapshot.contacts = [
      {
        id: "browser-contact",
        accountId: "telegram",
        platformId: "123456789",
        name: "Browser recipient",
        source: "manual",
        tags: [],
        projectIds: ["demo"],
        consent: { allowed: true, source: "Fixture owner", at: 1 },
        replyEligible: true,
        commentEligible: false,
        optedOut: false,
        history: [],
      },
    ];
    snapshot.threads = [
      {
        id: "browser-thread",
        accountId: "telegram",
        platformThreadId: "123456789",
        kind: "message",
        projectId: "demo",
        contactId: "browser-contact",
        lastInboundAt: 1,
        events: [
          {
            id: "browser-inbound",
            platformId: "telegram:123456789:1",
            text: "Browser message question",
            at: 1,
            direction: "inbound",
          },
        ],
      },
    ];
    snapshot.drafts = [
      {
        id: "browser-draft",
        accountId: "telegram",
        projectId: "demo",
        kind: "reply",
        threadId: "browser-thread",
        contactId: "browser-contact",
        text: "Approved browser draft",
        factIds: [],
        media: [{ kind: "image", uploadId: "previous-image" }],
        createdAt: 1,
        approvedAt: 1,
      },
    ];
    snapshot.campaigns = [];
    snapshot.approvedCampaignIds = [];
    snapshot.policies = { global: {}, platforms: {} };
  },
  // Explicit synthetic connected identities. This never reads or verifies a live account.
  socialFixtureSeedMediaCompletion: () => {
    browserWrites = true;
    snapshot.sendingEnabled = false;
    snapshot.accounts = [
      {
        ...snapshot.accounts[0],
        id: "linkedin",
        platform: "linkedin",
        platformId: "web:linkedin:in:fixture-owner",
        name: "Fixture LinkedIn",
        accountType: "member",
        connection: "browser",
        scopes: browserScopes("linkedin"),
      },
      {
        ...snapshot.accounts[0],
        id: "tiktok",
        platform: "tiktok",
        platformId: "fixture-tiktok-creator",
        name: "Fixture TikTok API",
        accountType: "member",
        connection: "oauth",
        scopes: ["user.info.basic", "video.publish"],
      },
      {
        ...snapshot.accounts[0],
        id: "snapchat",
        platform: "snapchat",
        platformId: "web:snapchat:public_profile:fixture-bycoda",
        name: "Fixture Snapchat",
        accountType: "public_profile",
        connection: "browser",
        scopes: browserScopes("snapchat"),
      },
    ].map((account) => ({
      ...account,
      connected: true,
      accessApproved: true,
      paused: false,
      executorId: "fixture",
      grants: { demo: ["read", "draft", "publish"] },
    })) as SocialSnapshot["accounts"];
    snapshot.capabilities = Object.fromEntries(
      snapshot.accounts.map((account) => [account.id, accountCapabilities(account)]),
    );
    snapshot.campaigns = [];
    snapshot.jobs = [];
    snapshot.approvedCampaignIds = [];
    snapshot.policies = { global: {}, platforms: {} };
  },
  socialFixtureSeedApiMedia: () => {
    browserWrites = true;
    snapshot.sendingEnabled = false;
    snapshot.accounts = (["instagram", "facebook", "whatsapp", "telegram"] as const).map(
      (platform): SocialSnapshot["accounts"][number] => ({
        id: platform,
        platform,
        platformId: platform === "telegram" ? "123456789" : "123456789012345",
        name: `Fixture ${platform === "instagram" ? "Instagram" : platform === "facebook" ? "Facebook" : platform === "whatsapp" ? "WhatsApp" : "Telegram"} API`,
        accountType:
          platform === "instagram"
            ? "professional"
            : platform === "facebook"
              ? "page"
              : platform === "whatsapp"
                ? "business"
                : "bot",
        connection: platform === "whatsapp" || platform === "telegram" ? "token" : "oauth",
        scopes:
          platform === "instagram"
            ? ["instagram_business_basic", "instagram_business_content_publish"]
            : platform === "facebook"
              ? ["pages_manage_posts", "pages_read_engagement"]
              : platform === "whatsapp"
                ? ["whatsapp_business_messaging", "bycoda.webhook"]
                : ["bot.send", "bot.poll"],
        connected: true,
        accessApproved: true,
        paused: false,
        executorId: "fixture",
        grants: { demo: ["read", "draft", "publish", "reply", "message"] },
        createdAt: 1,
      }),
    );
    snapshot.accounts.push({
      ...snapshot.accounts[0],
      id: "linkedin",
      platform: "linkedin",
      platformId: "urn:li:organization:12345",
      name: "Fixture LinkedIn API",
      accountType: "organization",
      connection: "oauth",
      scopes: ["w_organization_social", "r_organization_social"],
    });
    snapshot.accounts.push({
      ...snapshot.accounts[0],
      id: "snapchat-api",
      platform: "snapchat",
      platformId: "11111111-2222-4333-8444-555555555555",
      name: "Fixture Snapchat API",
      accountType: "public_profile",
      connection: "oauth",
      scopes: ["snapchat-profile-api"],
    });
    snapshot.capabilities = Object.fromEntries(
      snapshot.accounts.map((account) => [account.id, accountCapabilities(account)]),
    );
    snapshot.contacts = (["whatsapp", "telegram"] as const).map((platform) => ({
      id: `${platform}-api-contact`,
      accountId: platform,
      platformId: platform === "whatsapp" ? "+905551234567" : "123456789",
      name: `Fixture ${platform} recipient`,
      source: "manual",
      tags: [],
      projectIds: ["demo"],
      consent: { allowed: true, source: "Fixture owner", at: 1 },
      replyEligible: true,
      commentEligible: false,
      optedOut: false,
      history: [],
    }));
    snapshot.threads = (["whatsapp", "telegram"] as const).map((platform) => ({
      id: `${platform}-api-thread`,
      accountId: platform,
      platformThreadId: platform === "whatsapp" ? "+905551234567" : "123456789",
      kind: "message",
      projectId: "demo",
      contactId: `${platform}-api-contact`,
      lastInboundAt: Date.now(),
      replyUntil: Date.now() + 24 * 60 * 60_000,
      events: [
        {
          id: `${platform}-api-inbound`,
          platformId: `${platform}:inbound`,
          text: `${platform} API media question`,
          at: Date.now(),
          direction: "inbound",
        },
      ],
    }));
    snapshot.drafts = (["whatsapp", "telegram"] as const).map((platform) => ({
      id: `${platform}-api-draft`,
      accountId: platform,
      projectId: "demo",
      kind: "reply",
      threadId: `${platform}-api-thread`,
      contactId: `${platform}-api-contact`,
      text: `${platform} API approved reply`,
      factIds: [],
      media: [],
      createdAt: 1,
      approvedAt: 1,
    }));
    snapshot.campaigns = [];
    snapshot.jobs = [];
    snapshot.approvedCampaignIds = [];
    snapshot.policies = { global: {}, platforms: {} };
  },
  socialFixtureHold: (action: string) => {
    heldAction = action;
  },
  socialFixtureRelease: (reject = false) => {
    heldAction = undefined;
    releaseAction?.(reject);
    releaseAction = undefined;
  },
  socialFixtureConfigure: () => {
    configured = true;
  },
  socialFixtureManyProjects: () => {
    projects = [
      { id: "demo", cwd: "/demo", name: "Demo project" },
      { id: "local", cwd: "G:/Projects/my_projects/monocode", name: "monocode" },
      { id: "worktree", cwd: "/worktrees/monocode", name: "monocode" },
      ...Array.from({ length: 27 }, (_, index) => ({
        id: `project-${index}`,
        cwd: `/projects/service-${index}`,
        name: `Service ${index}`,
      })),
    ];
  },
  socialFixtureSeed: () => {
    snapshot.accounts[0].connected = true;
    snapshot.accounts[0].accessApproved = true;
    snapshot.accounts[0].platformId = "42";
    snapshot.accounts[0].scopes = [...X_BROWSER_SCOPES];
    snapshot.accounts[0].grants.demo = ["read", "draft", "publish", "reply", "message", "comment"];
    snapshot.capabilities.x = accountCapabilities(snapshot.accounts[0]);
    snapshot.contacts = [
      {
        id: "contact",
        accountId: "x",
        platformId: "demo-person",
        name: "Demo kişi",
        source: "manual",
        tags: ["ürün"],
        projectIds: ["demo"],
        replyEligible: true,
        commentEligible: false,
        optedOut: false,
        history: [],
      },
    ];
    snapshot.threads = ["first", "second"].map((id, index) => ({
      id,
      accountId: "x",
      platformThreadId: id,
      kind: "message",
      projectId: "demo",
      contactId: "contact",
      lastInboundAt: index + 1,
      events: [
        {
          id,
          platformId: id,
          text: index ? "İkinci konuşma" : "Demo ürün sorusu",
          at: 1,
          direction: "inbound",
        },
      ],
    }));
    snapshot.campaigns = [
      {
        id: "campaign",
        name: "Demo duyuru",
        projectIds: ["demo"],
        revision: 1,
        paused: false,
        createdAt: 1,
        variants: [
          {
            accountId: "x",
            text: "Demo duyuru içeriği",
            media: [],
            scheduledAt: Date.now() + 3600000,
            factIds: [],
          },
        ],
      },
    ];
    snapshot.profiles = [
      {
        projectId: "demo",
        productName: "Demo ürün",
        brandVoice: "Sade",
        facts: [
          {
            id: "fact",
            topic: "Destek",
            text: "Demo bilgi",
            source: "https://example.com",
            verifiedAt: 1,
          },
        ],
      },
    ];
    snapshot.drafts = [
      {
        id: "draft",
        accountId: "x",
        projectId: "demo",
        kind: "reply",
        threadId: "first",
        contactId: "contact",
        text: "Demo yanıt",
        factIds: [],
        createdAt: 1,
        reviewReason: "Metni inceleyin",
      },
    ];
    snapshot.policies = { global: { maxMessageCharacters: 40 }, platforms: {} };
    snapshot.approvedCampaignIds = ["campaign"];
  },
  socialFixtureWorkflow: () => {
    workflowWrites = true;
    snapshot.sendingEnabled = true;
    snapshot.contacts.push({
      ...snapshot.contacts[0],
      id: "optout",
      name: "İletişim istemeyen kişi",
      platformId: "optout-person",
      optedOut: true,
    });
    snapshot.contacts[0].consent = { allowed: true, source: "Fixture owner", at: 1 };
    snapshot.segments = [{ id: "group", name: "Ürün grubu", projectIds: ["demo"], tags: ["ürün"] }];
    snapshot.jobs = ["succeeded", "failed", "review", "queued", "cancelled"].map(
      (status, index) => ({
        id: `job-${index}`,
        operationId: `operation-${index}`,
        dedupeKey: `key-${index}`,
        accountId: "x",
        projectIds: ["demo"],
        provider: "owner",
        campaignId: "campaign",
        kind: "publish",
        payload: { text: `Doğrulama içeriği ${index}`, media: [] },
        status: status as SocialSnapshot["jobs"][number]["status"],
        scheduledAt: Date.now() + index * 60000,
        attempts: status === "queued" ? 0 : 1,
        createdAt: Date.now() - index * 60000,
        actorId: "owner",
        ...(status === "failed" ? { error: "Fixture platform rejected the request." } : {}),
      }),
    );
  },
  socialFixtureLargeHistory: () => {
    snapshot.threads = Array.from({ length: 125 }, (_, index) => ({
      ...snapshot.threads[0],
      id: `large-thread-${index}`,
      platformThreadId: `large-platform-${index}`,
      lastInboundAt: 125 - index,
      events: Array.from({ length: index === 124 ? 75 : 1 }, (_, event) => ({
        id: `large-event-${index}-${event}`,
        platformId: `large-event-${index}-${event}`,
        direction: "inbound" as const,
        at: event + 1,
        text:
          index === 124
            ? `${"x".repeat(400)} Archived message needle ${event}`
            : `Recent message ${index}`,
      })),
    }));
    snapshot.contacts = Array.from({ length: 125 }, (_, index) => ({
      ...snapshot.contacts[0],
      id: `large-contact-${index}`,
      name: index === 0 ? "Archived contact needle" : `Recent contact ${index}`,
      platformId: `large-person-${index}`,
      history: Array.from({ length: 75 }, (_, event) => ({
        operationId: `contact-operation-${index}-${event}`,
        kind: "inbound:message",
        at: event + 1,
      })),
    }));
    snapshot.threads.forEach((thread, index) => {
      thread.contactId = snapshot.contacts[index].id;
    });
    snapshot.jobs = Array.from({ length: 125 }, (_, index) => ({
      id: `large-job-${index}`,
      operationId: `large-operation-${index}`,
      dedupeKey: `large-key-${index}`,
      accountId: "x",
      projectIds: ["demo"],
      provider: "owner",
      actorId: "owner",
      kind: "publish" as const,
      payload: { text: index === 124 ? "Archived job needle" : `Recent job ${index}`, media: [] },
      status: index === 124 ? ("failed" as const) : ("succeeded" as const),
      createdAt: 125 - index,
      scheduledAt: 125 - index,
      attempts: 1,
    }));
    snapshot.drafts = [];
  },
  __TAURI_INTERNALS__: {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      calls.push({ command, args });
      if (command === "remote_machines")
        return [
          {
            id: "fixture",
            name: "Demo host",
            endpoint: "http://127.0.0.1:1",
            environmentId: "fixture",
            providers: [],
            capabilities: [],
          },
        ];
      if (command === "plugin:event|listen") return 1;
      if (command === "social_authority_status") return null;
      if (command === "remote_request") {
        if (args.method === "social.token.inspect" && telegramChannelFixture) {
          const input = args.params as { accountId: string; target: string };
          if (
            input.accountId !== "telegram-channel" ||
            !["@bycodaofficial", "-1001234567890"].includes(input.target)
          )
            throw new Error("Fixture channel target did not match");
          const review: SocialTelegramChannelReview = {
            reviewId: `fixture-channel-review-${telegramChannelReviews.size + 1}`,
            expiresAt: Date.now() + 120000,
            channelId: "-1001234567890",
            channelName: "Fixture Bycoda announcements",
            username: "bycodaofficial",
            botId: "123456789",
            botName: "Fixture Bycoda publisher",
          };
          telegramChannelReviews.set(review.reviewId, review);
          return structuredClone(review);
        }
        if (args.method === "social.token.connect" && telegramChannelFixture) {
          const input = args.params as { accountId: string; reviewId: string },
            review = telegramChannelReviews.get(input.reviewId);
          if (input.accountId !== "telegram-channel" || !review || Date.now() >= review.expiresAt)
            throw new Error("A current exact channel review is required");
          telegramChannelReviews.delete(input.reviewId);
          const account = snapshot.accounts.find((a) => a.id === input.accountId)!;
          Object.assign(account, {
            platformId: review.channelId,
            telegramBotId: review.botId,
            name: review.channelName,
            scopes: ["channel.publish"],
            connected: true,
            accessApproved: true,
          });
          snapshot.capabilities[account.id] = accountCapabilities(account);
          return structuredClone(account);
        }
        if (args.method === "projects.list") return structuredClone(projects);
        if (args.method === "social.browser.availability")
          return { available: true, reason: "Fixture Chrome only" };
        if (args.method === "social.browser.begin") {
          const input = args.params as { accountId: string; acknowledgeRisk: boolean };
          if (
            !input.acknowledgeRisk ||
            !snapshot.accounts.some((account) => account.id === input.accountId)
          )
            throw new Error("Fixture browser acknowledgement/account required.");
          browserFlows[input.accountId] = { status: "waiting", expiresAt: Date.now() + 600000 };
          return structuredClone(browserFlows[input.accountId]);
        }
        if (args.method === "social.browser.status") {
          const id = (args.params as { accountId: string }).accountId;
          return structuredClone(
            browserFlows[id] ?? {
              status: snapshot.accounts.some(
                (account) =>
                  account.id === id && account.connection === "browser" && account.connected,
              )
                ? "connected"
                : "idle",
            },
          );
        }
        if (args.method === "social.media.upload") {
          const input = args.params as {
            mode?: string;
            kind?: "document";
            uploadId?: string;
            offset?: number;
            base64?: string;
          };
          if (!browserWrites) throw new Error("Fixture browser media mode is required.");
          if (!input.mode || input.mode === "begin") {
            const kind = input.kind === "document" ? "document" : input.mode ? "video" : "image";
            const bytes = atob(input.base64 ?? "");
            if (kind === "document" && (!bytes.startsWith("%PDF-") || !/%%EOF\s*$/.test(bytes)))
              throw new Error("Fixture owner PDF content is invalid.");
            const uploadId = `fixture-${kind}-${mediaUploads.size + 1}`;
            mediaUploads.set(uploadId, {
              kind,
              offset: 0,
              ...(kind === "image" ? { base64: input.base64 } : {}),
            });
            return { uploadId };
          }
          const upload = mediaUploads.get(input.uploadId ?? "");
          if (!upload) throw new Error("Fixture upload not found.");
          if (input.mode === "chunk") {
            if (input.offset !== upload.offset) throw new Error("Fixture upload order changed.");
            upload.offset += atob(input.base64 ?? "").length;
          }
          if (input.mode === "cancel") mediaUploads.delete(input.uploadId!);
          return { uploadId: input.uploadId, offset: upload.offset };
        }
        if (args.method === "social.browser.profile.read")
          return structuredClone(
            pageProfileFixtures.get((args.params as { accountId: string }).accountId) ??
              xProfileFixture,
          );
        if (args.method === "social.browser.profile.update") {
          const input = args.params as {
            accountId: string;
            confirm: string;
            patch: Record<string, string>;
          };
          const pageProfile = pageProfileFixtures.get(input.accountId);
          if (pageProfile) {
            const platform = snapshot.accounts.find(
              (account) => account.id === input.accountId,
            )?.platform;
            const allowed =
              platform === "facebook"
                ? ["avatarUploadId"]
                : platform === "instagram"
                  ? ["bio", "avatarUploadId"]
                  : ["name", "bio", "avatarUploadId"];
            const confirmation =
              platform === "facebook"
                ? "UPDATE_FACEBOOK_PROFILE"
                : platform === "instagram"
                  ? "UPDATE_INSTAGRAM_PROFILE"
                  : "UPDATE_LINKEDIN_PROFILE";
            if (input.confirm !== confirmation)
              throw new Error("Exact Page confirmation is required.");
            if (Object.keys(input.patch).some((key) => !allowed.includes(key)))
              throw new Error("Unsupported Page profile field.");
            if (input.patch.avatarUploadId && !mediaUploads.has(input.patch.avatarUploadId))
              throw new Error("Owner image upload is required.");
            const updated = {
              ...pageProfile,
              ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
              ...(input.patch.bio !== undefined ? { bio: input.patch.bio } : {}),
            };
            pageProfileFixtures.set(input.accountId, updated);
            return structuredClone(updated);
          }
          const patch = (args.params as { patch: Partial<typeof xProfileFixture> }).patch;
          xProfileFixture = { ...xProfileFixture, ...patch };
          return structuredClone(xProfileFixture);
        }
        if (args.method === "social.browser.profile.follow")
          return {
            handle: (args.params as { handle: string }).handle,
            platformId: "123",
            following: true,
            changed: true,
          };
        if (
          args.method === "social.monitoring.status" &&
          (args.params as { accountId: string }).accountId !== "x"
        ) {
          const id = (args.params as { accountId: string }).accountId;
          const available = snapshot.capabilities[id] ?? [];
          const coverage = [
            ...(available.some(
              (item) => item.operation === "comments.read" && item.status === "available",
            )
              ? [{ channel: "comments", status: "read" }]
              : []),
            ...(available.some(
              (item) => item.operation === "inbox.read" && item.status === "available",
            )
              ? [{ channel: "messages", status: "read" }]
              : []),
          ];
          return {
            status: coverage.length ? "healthy" : "idle",
            pollingEnabled: false,
            accountActive: true,
            checkedAt: Date.now(),
            coverage,
          };
        }
        if (args.method === "social.monitoring.status")
          return {
            status: "partial",
            pollingEnabled: true,
            accountActive: true,
            checkedAt: Date.parse("2026-10-19T00:00:00Z"),
            coverage: [
              { channel: "mentions", status: "read" },
              { channel: "messages", status: "unavailable" },
            ],
          };
        if (args.method === "social.browser.workflow.status") {
          const { accountId } = args.params as { accountId: string };
          return {
            available: true,
            reason: "Fixture only",
            workflows: structuredClone(
              browserWorkflows.filter((item) => item.accountId === accountId),
            ),
          };
        }
        if (args.method === "social.browser.registration.review") {
          const input = args.params as {
            accountId: string;
            workflowId: string;
            expectedUpdatedAt: number;
          };
          const workflow = browserWorkflows.find(
            (item) => item.id === input.workflowId && item.accountId === input.accountId,
          );
          if (
            !workflow ||
            workflow.updatedAt !== input.expectedUpdatedAt ||
            workflow.registrationSubmission
          )
            throw new Error("Final registration changed or was already attempted.");
          const observed: SocialRegistrationReview = {
            reviewId: `review-${workflow.updatedAt}`,
            workflowId: workflow.id,
            accountId: workflow.accountId,
            updatedAt: workflow.updatedAt,
            expiresAt: Date.now() + 120000,
            platform: "linkedin",
            administrator: { id: "web:linkedin:in:fixture-admin", name: "Fixture Administrator" },
            fields: {
              displayName: "Bycoda",
              username: "bycoda",
              industry: "Software Development",
              organizationSize: "0–1 employees",
              organizationType: "Self-employed",
            },
            details: [
              { label: "Page name", value: "Bycoda" },
              { label: "Public username", value: "bycoda" },
              { label: "Industry", value: "Software Development" },
              { label: "Organization size", value: "0–1 employees" },
              { label: "Organization type", value: "Self-employed" },
            ],
            terms: {
              text: "I accept the LinkedIn Page Terms and confirm I am authorized to create this Page.",
              url: "https://www.linkedin.com/legal/l/page-terms",
            },
            submitLabel: "Create observed Page",
          };
          finalRegistrationReviews.set(observed.reviewId, observed);
          return structuredClone(observed);
        }
        if (args.method === "social.browser.registration.submit") {
          const input = args.params as {
            accountId: string;
            workflowId: string;
            expectedUpdatedAt: number;
            reviewId: string;
            confirm: string;
          };
          const workflow = browserWorkflows.find(
            (item) => item.id === input.workflowId && item.accountId === input.accountId,
          );
          const observed = finalRegistrationReviews.get(input.reviewId);
          if (
            !workflow ||
            !observed ||
            workflow.updatedAt !== input.expectedUpdatedAt ||
            observed.updatedAt !== workflow.updatedAt ||
            observed.accountId !== input.accountId ||
            input.confirm !== "CREATE_LINKEDIN_PAGE" ||
            workflow.registrationSubmission
          )
            throw new Error("Exact current owner review is required.");
          workflow.registrationSubmission = {
            id: "fixture-attempt",
            state: "unknown",
            attemptedAt: Date.now(),
            expectedResourceDigest: "a".repeat(64),
          };
          workflow.updatedAt++;
          finalRegistrationReviews.delete(input.reviewId);
          return structuredClone(workflow);
        }
        if (args.method === "social.browser.registration.reconcile") {
          const input = args.params as {
            accountId: string;
            workflowId: string;
            expectedUpdatedAt: number;
            resourceId: string;
          };
          const workflow = browserWorkflows.find(
            (item) => item.id === input.workflowId && item.accountId === input.accountId,
          );
          if (
            !workflow ||
            workflow.updatedAt !== input.expectedUpdatedAt ||
            workflow.registrationSubmission?.state !== "unknown" ||
            !workflow.registrationSubmission.expectedResourceDigest ||
            input.resourceId !== "145372363"
          )
            throw new Error("Existing Page does not match the original reviewed resource.");
          workflow.registrationSubmission = {
            ...workflow.registrationSubmission,
            state: "created",
            resourceId: input.resourceId,
            resourceUrl: `https://www.linkedin.com/company/${input.resourceId}/`,
          };
          workflow.updatedAt++;
          return structuredClone(workflow);
        }
        if (args.method === "social.browser.workflow.begin") {
          const input = args.params as {
            accountId: string;
            intent: import("../../src/features/social/model/socialBrowser").SocialBrowserIntent;
            registration?: SocialRegistrationProfile;
          };
          const account = snapshot.accounts.find((item) => item.id === input.accountId)!;
          if (input.intent === "signup" && account.connected)
            throw new Error("Fixture account is already connected.");
          if (
            browserWorkflows.some(
              (item) =>
                item.accountId === account.id && ["queued", "awaiting_owner"].includes(item.status),
            )
          )
            throw new Error("Fixture browser action is already active.");
          const workflow: import("../../src/features/social/model/socialBrowser").SocialBrowserWorkflow =
            {
              id: `workflow-${browserWorkflows.length}`,
              accountId: account.id,
              platform: account.platform,
              intent: input.intent,
              status: "awaiting_owner",
              outcome: "unverified",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              expiresAt: Date.now() + 1200000,
              ...(input.intent === "signup" && input.registration
                ? {
                    registration: fixtureRegistrationProgress(account.platform, input.registration),
                  }
                : {}),
            };
          browserWorkflows.unshift(workflow);
          return structuredClone(workflow);
        }
        if (args.method === "social.browser.registration.advance") {
          const input = args.params as {
            accountId: string;
            workflowId: string;
            expectedUpdatedAt: number;
            registration: SocialRegistrationProfile;
          };
          const account = snapshot.accounts.find((item) => item.id === input.accountId)!;
          const workflow = browserWorkflows.find(
            (item) => item.accountId === input.accountId && item.id === input.workflowId,
          );
          if (
            account.connected ||
            !workflow ||
            workflow.intent !== "signup" ||
            workflow.status !== "awaiting_owner" ||
            workflow.updatedAt !== input.expectedUpdatedAt
          )
            throw new Error("Fixture registration changed. Refresh its status.");
          workflow.registration = fixtureRegistrationProgress(account.platform, input.registration);
          workflow.updatedAt = Math.max(Date.now(), workflow.updatedAt + 1);
          return structuredClone(workflow);
        }
        if (args.method === "social.browser.workflow.cancel") {
          const { accountId } = args.params as { accountId: string };
          for (const workflow of browserWorkflows)
            if (workflow.accountId === accountId && workflow.status === "awaiting_owner")
              workflow.status = "cancelled";
          return null;
        }
        if (args.method === "social.oauth.availability")
          return Object.fromEntries(
            Object.keys(SOCIAL_ACCOUNT_TYPES).map((platform) => [
              platform,
              {
                configured:
                  (platform === "x" && configured) ||
                  (platform === "telegram" && telegramChannelFixture),
                reason: "Fixture configuration",
              },
            ]),
          );
        if (args.method === "social.oauth.status") return { status: oauthStatus, candidates: [] };
        if (args.method === "social.tiktok.creator")
          return {
            nickname: "Demo TikTok",
            privacyOptions: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"],
            commentDisabled: true,
            duetDisabled: false,
            stitchDisabled: false,
            maxDurationSeconds: 60,
          };
        if (args.method === "social.oauth.begin") {
          oauthStatus = "waiting";
          return {
            url: "https://platform.test/authorize",
            expiresAt: Date.now() + 100000,
          };
        }
        if (args.method === "social.request") {
          const params = args.params as { action: string; input?: Record<string, unknown> };
          if (params.action === heldAction)
            await new Promise<void>((resolve, reject) => {
              releaseAction = (fail) =>
                fail ? reject(new Error("Fixture request rejected.")) : resolve();
            });
          if (params.action === "programs.media-preview") {
            const uploadId = String(params.input?.uploadId ?? "");
            const upload = mediaUploads.get(uploadId);
            if (!upload || upload.kind !== "image" || !upload.base64)
              throw new Error("Fixture owner image upload not found.");
            const bytes = atob(upload.base64);
            if (bytes.length > 5 * 1024 * 1024)
              throw new Error("Fixture image preview exceeds its bound.");
            const mime =
              bytes.charCodeAt(0) === 137 && bytes.charCodeAt(1) === 80
                ? "image/png"
                : bytes.charCodeAt(0) === 255 && bytes.charCodeAt(1) === 216
                  ? "image/jpeg"
                  : undefined;
            if (!mime) throw new Error("Fixture image preview is unavailable.");
            return { base64: upload.base64, mime };
          }
          if (programFixture && params.action.startsWith("programs.")) {
            const input = params.input ?? {};
            if (params.action === "programs.list") return structuredClone(programRecords);
            if (params.action === "programs.features")
              return {
                capability: "social.programs.v2",
                executorId: "fixture",
                images: ["codex", "gemini", "comfyui"].map((provider) => ({
                  provider,
                  available: true,
                  reason: "Fixture only",
                  models: [`${provider}-fixture`],
                })),
                formats: {
                  x: { formats: ["text", "image"], requiresReview: false, allowsRepeat: false },
                },
              };
            if (params.action === "programs.configure") {
              const program = {
                ...(input.config as SocialProgram),
                id: "fixture-program",
                revision: 1,
                enabled: false,
                createdAt: 1,
                updatedAt: 1,
                executorId: "fixture",
                generationCount: 0,
                imageGenerationCount: 0,
                generationDay: "",
                dailyGenerationCount: 0,
                nextSequence: 0,
              };
              programRecords.push(program);
              return structuredClone(program);
            }
            if (params.action === "programs.status")
              return {
                program: structuredClone(programRecords.find((p) => p.id === input.id)),
                occurrences: [],
              };
            if (params.action === "programs.preview-schedule")
              return { dates: [Date.now() + 86400000] };
          }
          if (params.action === "snapshot") return structuredClone(snapshot);
          if (params.action === "workspace.snapshot")
            return fixtureWorkspace((params.input as SocialWorkspaceQuery) ?? {});
          if (params.action === "thread.page" || params.action === "contacts.history") {
            const input = params.input ?? {};
            const row = structuredClone(
              (params.action === "thread.page" ? snapshot.threads : snapshot.contacts).find(
                (row) => row.id === input.id,
              )!,
            );
            const field = params.action === "thread.page" ? "events" : "history";
            const entries = (row as unknown as Record<string, unknown[]>)[field];
            const limit = Number(input.limit ?? 20);
            const offset =
              input.offset === undefined
                ? Math.max(0, entries.length - limit)
                : Number(input.offset);
            Object.assign(row, {
              [field]: entries.slice(offset, offset + limit),
              [`${field}Page`]: { offset, limit, total: entries.length },
              ...(field === "events" ? { eventsPreview: false } : {}),
            });
            return row;
          }
          if (params.action === "policy.get") return { effective: snapshot.policies?.global ?? {} };
          const input = params.input ?? {};
          if (telegramChannelFixture && params.action === "campaigns.schedule") {
            const campaign = snapshot.campaigns.find((c) => c.id === input.id);
            if (
              !campaign ||
              !snapshot.sendingEnabled ||
              snapshot.stopped ||
              !snapshot.approvedCampaignIds?.includes(campaign.id)
            )
              throw new Error("Exact current campaign approval is required before queueing");
            if (snapshot.jobs.some((job) => job.campaignId === campaign.id))
              return structuredClone(snapshot.jobs.filter((job) => job.campaignId === campaign.id));
            for (const variant of campaign.variants) {
              const account = snapshot.accounts.find((a) => a.id === variant.accountId)!;
              if (
                !account.connected ||
                account.accountType !== "channel" ||
                account.platformId !== "-1001234567890" ||
                account.telegramBotId !== "123456789"
              )
                throw new Error("Reviewed channel connection is required");
              const issue = contentSupport(account, { kind: "publish", payload: variant });
              if (issue) throw new Error(issue);
              snapshot.jobs.push({
                id: `fixture-channel-job-${snapshot.jobs.length}`,
                operationId: `fixture-channel-operation-${campaign.id}`,
                dedupeKey: `fixture-channel-${campaign.id}-${campaign.revision}`,
                accountId: account.id,
                campaignId: campaign.id,
                projectIds: campaign.projectIds,
                provider: "owner",
                actorId: "owner",
                kind: "publish",
                payload: {
                  text: variant.text,
                  link: variant.link,
                  media: structuredClone(variant.media),
                },
                status: "queued",
                scheduledAt: variant.scheduledAt,
                createdAt: Date.now(),
                attempts: 0,
              });
            }
            return structuredClone(snapshot.jobs);
          }
          if (browserWrites) {
            if (params.action === "accounts.create") {
              const platform = input.platform as SocialSnapshot["accounts"][number]["platform"];
              const connection =
                input.connection as SocialSnapshot["accounts"][number]["connection"];
              const types =
                connection === "browser" ? SOCIAL_BROWSER_ACCOUNT_TYPES : SOCIAL_API_ACCOUNT_TYPES;
              if (!(types[platform] as readonly unknown[])?.includes(input.accountType))
                throw new Error("Fixture account type is unsupported.");
              const account: SocialSnapshot["accounts"][number] = {
                id: `fixture-account-${snapshot.accounts.length}`,
                platform,
                platformId: "",
                name: String(input.name),
                accountType: input.accountType as SocialSnapshot["accounts"][number]["accountType"],
                connection,
                scopes: [],
                connected: false,
                accessApproved: false,
                paused: false,
                executorId: "fixture",
                grants: Object.fromEntries(
                  (input.projectIds as string[]).map((id) => [id, ["read", "draft"]]),
                ),
                createdAt: Date.now(),
              };
              snapshot.accounts.push(account);
              snapshot.capabilities[account.id] = accountCapabilities(account);
              return structuredClone(account);
            }
            if (params.action === "drafts.update") {
              const draft = snapshot.drafts.find((item) => item.id === input.id)!;
              if (!draft) throw new Error("Fixture draft not found.");
              if (
                input.expectedDraft &&
                JSON.stringify(input.expectedDraft) !== JSON.stringify(draft)
              )
                throw new Error("Fixture draft changed.");
              const account = snapshot.accounts.find((item) => item.id === draft.accountId)!;
              const media = (input.media ?? draft.media ?? []) as SocialMedia[];
              const issue = contentSupport(account, {
                kind: draft.kind,
                payload: { text: String(input.text), media, recipientId: "123456789" },
              });
              if (issue) throw new Error(issue);
              draft.text = String(input.text);
              draft.factIds = input.factIds as string[];
              draft.media = structuredClone(media);
              delete draft.approvedAt;
              return structuredClone(draft);
            }
            if (params.action === "campaigns.create") {
              const previous = snapshot.campaigns.find((item) => item.id === input.id);
              if (previous && input.expectedRevision !== previous.revision)
                throw new Error("Fixture campaign changed.");
              const campaign: SocialSnapshot["campaigns"][number] = {
                id: previous?.id ?? `browser-campaign-${snapshot.campaigns.length}`,
                name: String(input.name),
                projectIds: input.projectIds as string[],
                variants: structuredClone(
                  input.variants as SocialSnapshot["campaigns"][number]["variants"],
                ),
                revision: (previous?.revision ?? 0) + 1,
                paused: false,
                createdAt: previous?.createdAt ?? Date.now(),
              };
              for (const variant of campaign.variants) {
                const account = snapshot.accounts.find((item) => item.id === variant.accountId)!;
                const issue = contentSupport(account, { kind: "publish", payload: variant });
                if (issue) throw new Error(issue);
                if (
                  (account.connection === "browser" || variant.facebook?.target === "reel") &&
                  variant.media.some(
                    (media) =>
                      !media.uploadId || mediaUploads.get(media.uploadId)?.kind !== media.kind,
                  )
                )
                  throw new Error("Fixture media was not uploaded by owner.");
              }
              snapshot.campaigns = [
                ...snapshot.campaigns.filter((item) => item.id !== campaign.id),
                campaign,
              ];
              snapshot.approvedCampaignIds = snapshot.approvedCampaignIds!.filter(
                (id) => id !== campaign.id,
              );
              return structuredClone(campaign);
            }
            if (params.action === "campaigns.preview") {
              const campaign = snapshot.campaigns.find((item) => item.id === input.id)!;
              if (!campaign) throw new Error("Fixture campaign not found.");
              return {
                campaign: structuredClone(campaign),
                targets: campaign.variants.map((variant) => {
                  const account = snapshot.accounts.find((item) => item.id === variant.accountId)!;
                  return {
                    accountId: account.id,
                    platform: account.platform,
                    capability: accountCapabilities(account).find(
                      (item) => item.operation === "publish",
                    )!,
                    contentError: contentSupport(account, {
                      kind: "publish",
                      payload: variant,
                    }),
                    approved: snapshot.approvedCampaignIds!.includes(campaign.id),
                  };
                }),
              };
            }
            if (["campaigns.approve", "campaigns.approveReviewed"].includes(params.action)) {
              const campaign = snapshot.campaigns.find((item) => item.id === input.id)!;
              if (
                !campaign ||
                (params.action === "campaigns.approveReviewed" &&
                  input.expectedRevision !== campaign.revision)
              )
                throw new Error("Fixture reviewed campaign revision changed.");
              snapshot.approvedCampaignIds = [
                ...new Set([...snapshot.approvedCampaignIds!, campaign.id]),
              ];
              return structuredClone(campaign);
            }
          }
          if (workflowWrites) {
            if (params.action === "segments.create") {
              const segment = {
                id: `segment-${snapshot.segments.length}`,
                name: String(input.name),
                projectIds: input.projectIds as string[],
                tags: input.tags as string[],
              };
              snapshot.segments.push(segment);
              return structuredClone(segment);
            }
            if (["replies.draft", "messages.draft", "comments.draft"].includes(params.action)) {
              const thread = snapshot.threads.find((item) => item.id === input.threadId);
              const contact = snapshot.contacts.find(
                (item) => item.id === (thread?.contactId ?? input.contactId),
              );
              if (!contact || contact.optedOut) throw new Error("Fixture contact is not eligible.");
              const draft = {
                id: `new-draft-${snapshot.drafts.length}`,
                accountId: contact.accountId,
                projectId: String(thread?.projectId ?? input.projectId),
                contactId: contact.id,
                kind:
                  params.action === "replies.draft"
                    ? ("reply" as const)
                    : params.action === "messages.draft"
                      ? ("message" as const)
                      : ("comment" as const),
                text: String(input.text),
                factIds: [],
                threadId: thread?.id,
                createdAt: Date.now(),
              };
              snapshot.drafts.push(draft);
              return structuredClone(draft);
            }
            if (params.action === "publishing-plans.create") {
              const plan: NonNullable<SocialSnapshot["publishingPlans"]>[number] = {
                id: "plan",
                name: String(input.name),
                accountId: String(input.accountId),
                projectId: String(input.projectId),
                campaigns: (input.campaignIds as string[]).map((id) => ({
                  campaignId: id,
                  revision: snapshot.campaigns.find((item) => item.id === id)!.revision,
                })),
                schedule: input.schedule as NonNullable<
                  SocialSnapshot["publishingPlans"]
                >[number]["schedule"],
                enabled: false,
                revision: 1,
                nextIndex: 0,
                createdAt: Date.now(),
              };
              snapshot.publishingPlans!.push(plan);
              return structuredClone(plan);
            }
            if (params.action === "publishing-plans.activate") {
              const plan = snapshot.publishingPlans!.find((item) => item.id === input.id)!;
              if (input.revision !== plan.revision) throw new Error("Fixture revision changed.");
              plan.enabled = true;
              plan.nextRunAt = Date.now() + 7200000;
              return structuredClone(plan);
            }
            if (params.action === "publishing-plans.pause") {
              const plan = snapshot.publishingPlans!.find((item) => item.id === input.id)!;
              plan.enabled = false;
              plan.pausedReason = "Paused by owner.";
              return structuredClone(plan);
            }
            if (params.action === "jobs.cancel") {
              snapshot.jobs.find((item) => item.id === input.id)!.status = "cancelled";
              return { cancelled: true };
            }
          }
          throw new Error(`Unexpected social mutation: ${params.action}`);
        }
      }
      return null;
    },
  },
});
document.body.style.cssText =
  "height:100vh;margin:0;background:var(--color-background-base);color:var(--color-content)";
function SocialFixture() {
  const [shown, setShown] = useState(true);
  Object.assign(window, { socialFixtureShow: setShown });
  if (new URLSearchParams(location.search).has("x-media")) return <XMediaFixture />;
  return (
    <div className="flex h-screen min-w-0 flex-col">
      <ToolPanel active={shown}>
        <SocialView cwd="/demo" besideRail onClose={() => setShown(false)} />
      </ToolPanel>
      {shown ? null : <div data-other-tool>Diğer araç</div>}
    </div>
  );
}
function XMediaFixture() {
  const [media, setMedia] = useState<SocialMedia[]>([]);
  const client = {
    upload: async () => ({ uploadId: "synthetic-image" }),
    uploadVideo: async (_file: File, progress: (percent: number) => void) => {
      progress(100);
      return { uploadId: "synthetic-video" };
    },
  } as unknown as SocialClient;
  return (
    <main className="bycoda-arc">
      <XMediaFields value={media} client={client} onChange={setMedia} />
      <output aria-label="Eklerin türleri">{media.map((item) => item.kind).join(",")}</output>
    </main>
  );
}
const fixtureQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={fixtureQueryClient}>
    <SocialFixture />
  </QueryClientProvider>,
);
