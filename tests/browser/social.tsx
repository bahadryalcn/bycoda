import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ToolPanel } from "../../src/app/shell/ToolNavigation";
import { SocialView } from "../../src/features/social/ui/SocialView";
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
const programRecords: SocialProgram[] = [];

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
let configured = false;
let oauthStatus = "idle";
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
    snapshot.accounts[0].grants.demo = ["read", "draft", "publish", "reply", "message", "comment"];
    snapshot.capabilities.x = [
      "publish",
      "reply",
      "inbox.read",
      "message.reply",
      "message.start",
      "comments.read",
      "comment",
      "poll",
    ].map((operation) => ({
      operation: operation as SocialSnapshot["capabilities"][string][number]["operation"],
      status: "available",
      reason: "Fixture access",
      scopes: [],
      source: "https://example.com",
    }));
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
        if (args.method === "projects.list") return structuredClone(projects);
        if (args.method === "social.oauth.availability")
          return { x: { configured, reason: "Fixture configuration" } };
        if (args.method === "social.oauth.status") return { status: oauthStatus, candidates: [] };
        if (args.method === "social.oauth.begin") {
          oauthStatus = "waiting";
          return {
            url: "https://platform.test/authorize",
            expiresAt: Date.now() + 100000,
          };
        }
        if (args.method === "social.request") {
          const params = args.params as { action: string; input?: Record<string, unknown> };
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
          if (workflowWrites) {
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
  return (
    <div className="flex h-screen min-w-0 flex-col">
      <ToolPanel active={shown}>
        <SocialView cwd="/demo" besideRail onClose={() => setShown(false)} />
      </ToolPanel>
      {shown ? null : <div data-other-tool>Diğer araç</div>}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<SocialFixture />);
