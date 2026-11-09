import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SocialPerson } from "../../../src/features/social/model/audience";
import type {
  EmailAccount,
  Sequence,
  SequenceStep,
} from "../../../src/features/social/model/outreach";
import type { SocialAccount, SocialContact } from "../../../src/features/social/model/social";
import { HostStore } from "../../store";
import { authorizeAutonomous } from "../autonomy/autonomy-gate";
import {
  defaultAutonomyPolicy,
  parseAutonomyInput,
  saveAutonomyPolicy,
} from "../autonomy/autonomy-policy";
import type { SocialServiceApi } from "../core/social-service-api";
import type { SocialPrincipal } from "../social";
import { SocialAudienceStore } from "../store/social-audience-store";

/** Test clock: 2026-11-07 12:00 UTC. No working hours are set, so the account is always open. */
export const NOW = Date.UTC(2026, 10, 7, 12);

/** A real SQLite-backed audience store in a temporary directory. */
export async function audienceFixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-outreach-"));
  const store = new HostStore(join(directory, "host.db"));
  await store.ready;
  const audience = new SocialAudienceStore(store);
  await audience.initialize();
  return {
    audience,
    cleanup: async () => {
      await store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function xAccount(overrides: Partial<SocialAccount> = {}): SocialAccount {
  return {
    id: "acc-x",
    platform: "x",
    platformId: "100",
    name: "Brand",
    accountType: "member",
    scopes: [],
    accessApproved: true,
    connected: true,
    connection: "oauth",
    paused: false,
    executorId: "exec-1",
    grants: { "proj-1": ["draft", "message", "comment", "read"] },
    ...overrides,
  } as SocialAccount;
}

export function contactFor(
  id: string,
  accountId: string,
  platformId: string,
  overrides: Partial<SocialContact> = {},
): SocialContact {
  return {
    id,
    accountId,
    platformId,
    name: `Name ${platformId}`,
    source: "import",
    tags: [],
    projectIds: ["proj-1"],
    replyEligible: true,
    commentEligible: true,
    optedOut: false,
    history: [],
    ...overrides,
  };
}

export function personFor(
  id: string,
  accountId: string,
  platformId: string,
  contactId: string,
  overrides: Partial<SocialPerson> = {},
): SocialPerson {
  return {
    id,
    name: `Person ${id}`,
    handles: [{ accountId, platform: "x", platformId, contactId, username: `user_${platformId}` }],
    emails: [],
    tags: [],
    notes: "",
    stage: "new",
    source: "import",
    projectIds: ["proj-1"],
    consent: { basis: "none" },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function emailAccount(overrides: Partial<EmailAccount> = {}): EmailAccount {
  return {
    id: "mail-1",
    kind: "resend",
    from: "hello@example.com",
    name: "Brand mail",
    unsubscribeUrl: "https://example.com/unsubscribe",
    createdAt: NOW,
    ...overrides,
  };
}

export function sequenceWith(steps: SequenceStep[], overrides: Partial<Sequence> = {}): Sequence {
  return {
    id: "seq-1",
    name: "Outreach",
    listId: "list-1",
    steps,
    status: "active",
    stopOnReply: true,
    pacing: { perHour: 100, perDay: 1000, warmupDays: 0 },
    createdAt: NOW,
    ...overrides,
  };
}

/** Sets an autonomy level for one account through the real policy code. */
export async function setAutonomy(
  audience: SocialAudienceStore,
  accountId: string,
  levels: Partial<Record<string, "suggest" | "approve" | "autonomous">>,
): Promise<void> {
  const patch = parseAutonomyInput({ levels }, defaultAutonomyPolicy(accountId));
  await saveAutonomyPolicy(audience, accountId, patch, "owner-test", NOW);
}

export type FakeServiceOptions = {
  audience: SocialAudienceStore;
  settings?: Record<string, string>;
  accounts?: SocialAccount[];
  contacts?: SocialContact[];
  /** Overrides of assertSendable; a throwing function marks the target suppressed. */
  assertSendable?: (
    target: { personId?: string; contactId?: string; email?: string },
    channel: string,
  ) => Promise<void>;
  principal?: SocialPrincipal;
};

/**
 * Stand-in for SocialServiceApi. Autonomy and suppression use the real gate code; drafts and jobs
 * are recorded, never sent.
 */
export function fakeService(options: FakeServiceOptions) {
  const settings: Record<string, string> = { sending: "true", ...(options.settings ?? {}) };
  const accounts = new Map(
    (options.accounts ?? [xAccount()]).map((account) => [account.id, account]),
  );
  const contacts = new Map((options.contacts ?? []).map((contact) => [contact.id, contact]));
  const drafts: { action: string; input: Record<string, unknown> }[] = [];
  const jobs: { draftId: string; plural: string; principal: SocialPrincipal }[] = [];
  const aiActions: { action: string; status: string; reason?: string; accountId?: string }[] = [];
  let counter = 0;
  const service = {
    setting: async (key: string) => settings[key],
    account: async (id: string) => {
      const account = accounts.get(id);
      if (!account) throw new Error("Social account not found.");
      return account;
    },
    contact: async (id: string) => contacts.get(id),
    access: async (_principal: SocialPrincipal, accountId: string) => {
      const account = accounts.get(accountId);
      if (!account) throw new Error("Social account not found.");
      return account;
    },
    capability: () => undefined,
    assertSendable: async (
      target: { personId?: string; contactId?: string; email?: string },
      channel: string,
    ) => {
      if (options.assertSendable) return await options.assertSendable(target, channel);
      const rows = await options.audience.findSuppressions({
        ...(target.personId ? { personId: target.personId } : {}),
        ...(target.email ? { email: target.email } : {}),
      });
      if (rows.some((row) => row.channel === "all" || row.channel === channel))
        throw new Error("Recipient is suppressed for this channel. Nothing was sent.");
    },
    authorizeAutonomous: async (input: {
      accountId: string;
      action: "message" | "comment" | "email" | "outreach" | "publish" | "reply";
      principal: SocialPrincipal;
    }) =>
      await authorizeAutonomous(
        { audience: options.audience, setting: async (key) => settings[key], now: () => NOW },
        input,
      ),
    recordAiAction: async (action: {
      action: string;
      status: string;
      reason?: string;
      accountId?: string;
    }) => {
      aiActions.push(action);
    },
    createDraft: async (
      _principal: SocialPrincipal,
      action: string,
      input: Record<string, unknown>,
    ) => {
      drafts.push({ action, input });
      return { id: `draft-${++counter}` };
    },
    sendDraft: async (principal: SocialPrincipal, draftId: string, plural: string) => {
      jobs.push({ draftId, plural, principal });
      return { id: `job-${counter}` };
    },
  };
  return { service: service as unknown as SocialServiceApi, settings, drafts, jobs, aiActions };
}

export const OWNER: SocialPrincipal = { kind: "owner", actorId: "owner", provider: "owner" };
