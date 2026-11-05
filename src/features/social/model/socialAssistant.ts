import { t } from "../../../shared/i18n";
import type { SocialAccount, SocialProjectProfile } from "./social";
import { defaultProgram, programApprovalSteps, type ProgramConfig } from "./socialProgram";

/** What the owner selected before asking; the assistant never widens it. */
export type AssistantContext = {
  machineLabel: string;
  projectId: string;
  projectName: string;
  accountIds: string[];
  profile?: SocialProjectProfile;
};

/** Accounts the assistant may prepare content for: draft access to the selected project. */
export function assistantEligibleAccounts(accounts: SocialAccount[], projectId: string) {
  return accounts.filter((account) => account.grants[projectId]?.includes("draft"));
}

const flat = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * The structured starting point `programs.suggest` refines. It is the strictest approval mode
 * and carries only owner-selected accounts, the project's saved voice and its verified facts.
 * Nothing here can grant send authority; the Host keeps the result paused.
 */
export function assistantBaseConfig(input: {
  request: string;
  context: AssistantContext;
  language: string;
  useFacts: boolean;
  now?: number;
}): ProgramConfig {
  const { request, context, language, useFacts } = input;
  const base = defaultProgram(context.projectId, input.now ?? Date.now());
  const text = flat(request);
  return {
    ...base,
    name: text.slice(0, 80) || t("AI campaign"),
    accountIds: [...context.accountIds],
    brief: {
      ...base.brief,
      topic: text.slice(0, 200),
      description: text.slice(0, 2000),
      language,
      voice: context.profile?.brandVoice ?? "",
      factIds: useFacts ? (context.profile?.facts ?? []).slice(0, 100).map((fact) => fact.id) : [],
    },
    approval: { mode: "approved", steps: programApprovalSteps("approved") },
  };
}

export type ProposalRow = { key: string; label: string; before?: string; after: string };

/** Fields shown as a concrete before/after list; only changed fields are listed for edits. */
export function proposalChangedKeys(proposal: ProgramConfig, base?: ProgramConfig): string[] {
  const keys = Object.keys(proposal) as (keyof ProgramConfig)[];
  if (!base) return keys.filter((key) => key !== "mediaOverrides" || !!proposal.mediaOverrides);
  return keys.filter((key) => JSON.stringify(proposal[key]) !== JSON.stringify(base[key]));
}

export type ProposalRisk = { id: string; text: string };

/**
 * Review warnings derived from the proposal itself. The AI may suggest anything the Host
 * validates; these call out the choices that reduce the owner's review.
 */
export function proposalRisks(proposal: ProgramConfig, base: ProgramConfig): ProposalRisk[] {
  const risks: ProposalRisk[] = [];
  if (proposal.approval.mode === "automatic" && base.approval.mode !== "automatic")
    risks.push({
      id: "approval-automatic",
      text: t(
        "The suggestion turns off review steps. Choose a stricter approval mode below if you want to review each post.",
      ),
    });
  if (
    proposal.approval.steps.length < base.approval.steps.length &&
    proposal.approval.mode !== "automatic"
  )
    risks.push({
      id: "approval-fewer",
      text: t("The suggestion asks for fewer review steps than your starting point."),
    });
  if (proposal.totalPosts === null || (proposal.totalPosts ?? 0) > 60)
    risks.push({
      id: "posts-many",
      text: t("The suggestion plans many posts. Check the count before saving."),
    });
  if (!proposal.brief.factIds.length && base.brief.factIds.length)
    risks.push({
      id: "facts-dropped",
      text: t("The suggestion does not use the verified facts you provided."),
    });
  return risks;
}

/** Number of publishing slots the schedule can create within a week; a short, readable bound. */
export function weeklyPostBound(config: ProgramConfig): number | undefined {
  const { schedule } = config;
  if (schedule.mode === "times") return schedule.times.length * schedule.days.length;
  if (schedule.mode === "frequency")
    return schedule.period === "day"
      ? schedule.frequency * schedule.days.length
      : schedule.frequency;
  return undefined;
}

/** Idempotency key for one proposal acceptance: a retry returns the original Host receipt. */
export function proposalRequestId() {
  return crypto.randomUUID();
}
