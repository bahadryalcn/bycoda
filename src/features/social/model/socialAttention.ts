import { t } from "../../../shared/i18n";
import type { SocialProgram } from "./socialProgram";
import type { SocialJob, SocialSnapshot } from "./social";

/** Destinations the attention list can open; they mirror the Social tabs. */
export type AttentionTarget =
  | "Accounts"
  | "Campaigns"
  | "Inbox"
  | "Automations"
  | "Activity"
  | "Sending"
  | "Settings";

/** Workspace reads the Today view composes. Each one fails, loads and empties on its own. */
export type AttentionSource = "campaigns" | "inbox" | "plans" | "history" | "programs";

export type AttentionSourceState<T = SocialSnapshot> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

export type AttentionSources = {
  campaigns: AttentionSourceState;
  inbox: AttentionSourceState;
  plans: AttentionSourceState;
  history: AttentionSourceState;
  /** `unsupported` when the Host has no campaign programs; not an error. */
  programs: AttentionSourceState<SocialProgram[]> | { status: "unsupported" };
};

export type AttentionItem = {
  id: string;
  tone: "danger" | "warning" | "info";
  title: string;
  detail?: string;
  count: number;
  target: AttentionTarget;
  action: string;
};

export type UpcomingItem = {
  id: string;
  at: number;
  title: string;
  detail: string;
  target: AttentionTarget;
};

export type AttentionResult = {
  items: AttentionItem[];
  upcoming: UpcomingItem[];
  /** Sources that could not be read; their absence must never read as "nothing to do". */
  unavailable: { source: AttentionSource; state: "loading" | "error"; message?: string }[];
  /** Real, exact failure reasons from loaded Activity rows (no model involved). */
  failures: { reason: string; count: number; accounts: string[] }[];
};

const excerpt = (text: string, max = 72) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function jobCount(snapshot: SocialSnapshot, status: SocialJob["status"]) {
  return snapshot.jobCounts?.[status] ?? snapshot.jobs.filter((job) => job.status === status).length;
}

/**
 * Builds the "needs attention now" list strictly from Host data that was actually read.
 * A source that is loading or failed is reported in `unavailable`; it never produces a
 * zero-count "all clear" row.
 */
export function buildAttention(input: {
  base: SocialSnapshot;
  sources: AttentionSources;
  now: number;
}): AttentionResult {
  const { base, sources, now } = input;
  const items: AttentionItem[] = [];
  const upcoming: UpcomingItem[] = [];
  const unavailable: AttentionResult["unavailable"] = [];
  const failures: AttentionResult["failures"] = [];
  const accountName = (id: string) =>
    base.accounts.find((account) => account.id === id)?.name ?? t("Removed account");
  const note = (source: AttentionSource, state: { status: string; message?: string }) => {
    if (state.status === "loading" || state.status === "error")
      unavailable.push({
        source,
        state: state.status as "loading" | "error",
        ...(state.status === "error" ? { message: state.message } : {}),
      });
  };

  if (!base.hostOnline)
    items.push({
      id: "host-offline",
      tone: "danger",
      title: t("Scheduling is offline"),
      detail: t("Queued posts wait until the selected computer is back online."),
      count: 1,
      target: "Activity",
      action: t("Open activity"),
    });
  if (base.stopped)
    items.push({
      id: "sending-paused",
      tone: "warning",
      title: t("Sending is paused"),
      detail: t("Nothing is dispatched until sending is resumed."),
      count: 1,
      target: "Sending",
      action: t("Sending controls"),
    });

  // Accounts: connection, platform authorization and pause are different states.
  if (!base.accounts.length)
    items.push({
      id: "accounts-none",
      tone: "info",
      title: t("No account added yet"),
      detail: t("Add an account to prepare content for it."),
      count: 0,
      target: "Accounts",
      action: t("Add account"),
    });
  const disconnected = base.accounts.filter((account) => !account.connected);
  const unauthorized = base.accounts.filter((account) => account.connected && !account.accessApproved);
  const paused = base.accounts.filter((account) => account.paused);
  const noProject = base.accounts.filter((account) => !Object.values(account.grants).some((grant) => grant.length));
  if (disconnected.length)
    items.push({
      id: "accounts-disconnected",
      tone: "warning",
      title: t("{p0} accounts are not connected", { p0: disconnected.length }),
      detail: disconnected.slice(0, 3).map((account) => account.name).join(", "),
      count: disconnected.length,
      target: "Accounts",
      action: t("Connect"),
    });
  if (unauthorized.length)
    items.push({
      id: "accounts-awaiting-access",
      tone: "warning",
      title: t("{p0} accounts await platform access", { p0: unauthorized.length }),
      detail: unauthorized.slice(0, 3).map((account) => account.name).join(", "),
      count: unauthorized.length,
      target: "Accounts",
      action: t("Review access"),
    });
  if (paused.length)
    items.push({
      id: "accounts-paused",
      tone: "info",
      title: t("{p0} accounts are paused", { p0: paused.length }),
      detail: paused.slice(0, 3).map((account) => account.name).join(", "),
      count: paused.length,
      target: "Accounts",
      action: t("Open accounts"),
    });
  if (noProject.length && base.accounts.length)
    items.push({
      id: "accounts-no-project",
      tone: "info",
      title: t("{p0} accounts have no project access", { p0: noProject.length }),
      detail: t("Grant a project before content can be prepared for them."),
      count: noProject.length,
      target: "Accounts",
      action: t("Set permissions"),
    });

  // Activity: failures and uncertain results lead; they are never reported as success.
  note("history", sources.history);
  if (sources.history.status === "ready") {
    const snapshot = sources.history.data;
    const failed = jobCount(snapshot, "failed");
    const review = jobCount(snapshot, "review");
    if (failed + review)
      items.push({
        id: "jobs-problem",
        tone: "danger",
        title: t("{p0} sends need your attention", { p0: failed + review }),
        detail: review
          ? t("{p0} failed · {p1} with an unverified result; do not resend those.", { p0: failed, p1: review })
          : t("{p0} failed", { p0: failed }),
        count: failed + review,
        target: "Activity",
        action: t("Review"),
      });
    const grouped = new Map<string, { count: number; accounts: Set<string> }>();
    for (const job of snapshot.jobs)
      if (job.status === "failed" && job.error) {
        const entry = grouped.get(job.error) ?? { count: 0, accounts: new Set<string>() };
        entry.count++;
        entry.accounts.add(accountName(job.accountId));
        grouped.set(job.error, entry);
      }
    for (const [reason, entry] of [...grouped].sort((a, b) => b[1].count - a[1].count).slice(0, 3))
      failures.push({ reason, count: entry.count, accounts: [...entry.accounts] });
    for (const job of snapshot.jobs)
      if (job.status === "queued" && job.scheduledAt >= now - 60_000)
        upcoming.push({
          id: `job:${job.id}`,
          at: job.scheduledAt,
          title: excerpt(job.payload.text) || t("Post without text"),
          detail: `${accountName(job.accountId)} · ${t("Queued")}`,
          target: "Activity",
        });
  }

  // Content: unapproved/unscheduled campaigns need a decision from the owner.
  note("campaigns", sources.campaigns);
  if (sources.campaigns.status === "ready") {
    const snapshot = sources.campaigns.data;
    const drafts = snapshot.campaigns.filter((campaign) => {
      const state = snapshot.campaignStates?.[campaign.id];
      return state ? state === "draft" : !snapshot.jobs.some((job) => job.campaignId === campaign.id) && !campaign.paused;
    });
    if (drafts.length)
      items.push({
        id: "campaigns-draft",
        tone: "info",
        title: t("{p0} content items are not scheduled yet", { p0: drafts.length }),
        detail: drafts.slice(0, 3).map((campaign) => campaign.name).join(", "),
        count: drafts.length,
        target: "Campaigns",
        action: t("Review content"),
      });
  }

  // Replies: drafts waiting for exact review, and conversations flagged by the Host.
  note("inbox", sources.inbox);
  if (sources.inbox.status === "ready") {
    const snapshot = sources.inbox.data;
    const waiting = snapshot.drafts.filter((draft) => !draft.approvedAt);
    const flagged = snapshot.threads.filter((thread) => thread.reviewReason);
    if (waiting.length)
      items.push({
        id: "drafts-waiting",
        tone: "warning",
        title: t("{p0} reply drafts await review", { p0: snapshot.pages?.drafts?.total ?? waiting.length }),
        detail: t("Approve the exact text before it can be sent."),
        count: snapshot.pages?.drafts?.total ?? waiting.length,
        target: "Inbox",
        action: t("Open Inbox"),
      });
    if (flagged.length)
      items.push({
        id: "threads-flagged",
        tone: "warning",
        title: t("{p0} conversations need a manual look", { p0: flagged.length }),
        detail: excerpt(flagged[0].reviewReason ?? ""),
        count: flagged.length,
        target: "Inbox",
        action: t("Open Inbox"),
      });
  }

  // Plans and campaign programs: what is paused and what runs next.
  note("plans", sources.plans);
  if (sources.plans.status === "ready") {
    const plans = sources.plans.data.publishingPlans ?? [];
    const pausedPlans = plans.filter((plan) => !plan.enabled && !plan.completedAt);
    if (pausedPlans.length)
      items.push({
        id: "plans-paused",
        tone: "info",
        title: t("{p0} sharing plans are paused", { p0: pausedPlans.length }),
        detail: pausedPlans.slice(0, 3).map((plan) => plan.name).join(", "),
        count: pausedPlans.length,
        target: "Automations",
        action: t("Open plans"),
      });
    for (const plan of plans)
      if (plan.enabled && plan.nextRunAt && plan.nextRunAt >= now - 60_000)
        upcoming.push({
          id: `plan:${plan.id}`,
          at: plan.nextRunAt,
          title: plan.name,
          detail: `${accountName(plan.accountId)} · ${t("Sharing plan")}`,
          target: "Automations",
        });
  }
  if (sources.programs.status !== "unsupported") {
    note("programs", sources.programs);
    if (sources.programs.status === "ready") {
      const programs = sources.programs.data.filter((program) => !program.cancelled);
      const pausedPrograms = programs.filter((program) => !program.enabled);
      if (pausedPrograms.length)
        items.push({
          id: "programs-paused",
          tone: "info",
          title: t("{p0} saved campaigns are paused", { p0: pausedPrograms.length }),
          detail: t("Review and activate them when ready."),
          count: pausedPrograms.length,
          target: "Campaigns",
          action: t("Review"),
        });
      for (const program of programs)
        if (program.enabled && program.nextAt && program.nextAt >= now - 60_000)
          upcoming.push({
            id: `program:${program.id}`,
            at: program.nextAt,
            title: program.name,
            detail: `${program.accountIds.map(accountName).join(", ")} · ${t("Recurring content")}`,
            target: "Campaigns",
          });
    }
  }

  const order = { danger: 0, warning: 1, info: 2 } as const;
  items.sort((a, b) => order[a.tone] - order[b.tone]);
  upcoming.sort((a, b) => a.at - b.at);
  return { items, upcoming: upcoming.slice(0, 6), unavailable, failures };
}
