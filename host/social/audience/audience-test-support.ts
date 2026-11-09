import { afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import type { AutonomyLevel } from "../../../src/features/social/model/autonomy";
import type { SocialAccount, SocialContact } from "../../../src/features/social/model/social";
import type { SocialAdapter } from "../../../src/integrations/social/adapter";
import type { SocialActionContext } from "../core/social-actions";
import type { SocialServiceApi } from "../core/social-service-api";
import type { SocialPrincipal } from "../social";
import { SocialAudienceStore, migrateAudience } from "../store/social-audience-store";

export const NOW = 1_800_000_000_000;

export const OWNER: SocialPrincipal = { kind: "owner", actorId: "owner", provider: "test" };
export const AI: SocialPrincipal = {
  kind: "external",
  actorId: "ai:test",
  provider: "test",
  projectId: "p1",
};

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

export function account(patch: Partial<SocialAccount> = {}): SocialAccount {
  return {
    id: "acc-x",
    platform: "x",
    platformId: "x-owner",
    name: "Brand",
    accountType: "member",
    scopes: [],
    accessApproved: true,
    connected: true,
    connection: "oauth",
    paused: false,
    executorId: "test",
    grants: { p1: ["read", "draft"] },
    createdAt: NOW,
    ...patch,
  } as SocialAccount;
}

/**
 * A real audience store on a temporary database, plus a fake SocialServiceApi that covers the
 * methods the audience actions call. The fake upsertContact only stores the contact record.
 */
export async function fixture(
  options: {
    levels?: Record<string, AutonomyLevel>;
    accounts?: SocialAccount[];
    adapter?: Partial<SocialAdapter>;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-audience-actions-"));
  const host = new HostStore(join(directory, "host.db"));
  await host.ready;
  const store = new SocialAudienceStore(host);
  await store.initialize();
  await migrateAudience(store, { accounts: [], contacts: [], segments: [] }, NOW);
  cleanups.push(async () => {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const accounts = new Map((options.accounts ?? [account()]).map((item) => [item.id, item]));
  const contacts = new Map<string, SocialContact>();
  const levels = options.levels ?? {};
  const service = {
    account: async (id: string) => {
      const found = accounts.get(id);
      if (!found) throw new Error("Social account not found.");
      return found;
    },
    accounts: async () => [...accounts.values()],
    access: async (principal: SocialPrincipal, accountId: string, permission: string) => {
      const found = accounts.get(accountId);
      if (!found) throw new Error("Social account not found.");
      if (
        principal.kind !== "owner" &&
        !found.grants[principal.projectId ?? ""]?.includes(permission as never)
      )
        throw new Error("This project has no permission for this social account.");
      return found;
    },
    contact: async (id: string) => contacts.get(id),
    upsertContact: async (principal: SocialPrincipal, input: Record<string, unknown>) => {
      const accountId = String(input.accountId);
      const platformId = String(input.platformId);
      const id = `contact-${accountId}-${platformId}`;
      const previous = contacts.get(id);
      const contact: SocialContact = {
        id,
        accountId,
        platformId,
        name: String(input.name ?? previous?.name ?? platformId),
        ...(typeof input.profileUrl === "string" ? { profileUrl: input.profileUrl } : {}),
        source: (input.source as SocialContact["source"]) ?? previous?.source ?? "manual",
        tags: (input.tags as string[] | undefined) ?? previous?.tags ?? [],
        ...(typeof input.language === "string" ? { language: input.language } : {}),
        projectIds: (input.projectIds as string[] | undefined) ??
          previous?.projectIds ?? [principal.projectId ?? "p1"],
        replyEligible: false,
        commentEligible: false,
        optedOut: false,
        history: [],
      };
      contacts.set(id, contact);
      return contact;
    },
    authorizeAutonomous: async (input: { accountId: string; action: string }) => {
      const level = levels[input.accountId] ?? "suggest";
      if (level !== "autonomous") return { mode: level };
      return {
        mode: "autonomous",
        approval: { kind: "autonomy", accountId: input.accountId, version: 1 },
        scheduledAt: NOW,
      };
    },
    adapterFor: () => {
      if (!options.adapter) throw new Error("adapter not configured for this test");
      return options.adapter;
    },
    credentialFor: async () => ({ accessToken: "token-test" }),
  } as unknown as SocialServiceApi;

  const ctx = (principal: SocialPrincipal = OWNER): SocialActionContext => ({
    service,
    store,
    now: () => NOW,
    principal,
    operationId: `op-${Math.random().toString(36).slice(2, 8)}`,
  });

  return { store, host, service, accounts, contacts, ctx, levels };
}

/** A stored contact for one platform identity, as the ingest path would create it. */
export function contactOf(
  accountId: string,
  platformId: string,
  patch: Partial<SocialContact> = {},
): SocialContact {
  return {
    id: `contact-${accountId}-${platformId}`,
    accountId,
    platformId,
    name: platformId,
    source: "api",
    tags: [],
    projectIds: ["p1"],
    replyEligible: true,
    commentEligible: false,
    optedOut: false,
    history: [],
    ...patch,
  };
}
