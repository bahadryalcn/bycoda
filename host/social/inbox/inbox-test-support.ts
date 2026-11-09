import type {
  Capability,
  SocialAccount,
  SocialContact,
  SocialPlatform,
  SocialThread,
} from "../../../src/features/social/model/social";
import type { Interaction, SocialPerson } from "../../../src/features/social/model/audience";
import type { SocialActionContext } from "../core/social-actions";
import type { SocialPrincipal } from "../social";
import type { SocialServiceApi } from "../core/social-service-api";
import type { SocialAudienceStore } from "../store/social-audience-store";
import type { InboxStatusRecord } from "./inbox-types";

/** Fake accounts. `caps` is read by the mocked accountCapabilities in each test file. */
export function account(
  id: string,
  platform: SocialPlatform,
  caps: Capability[],
  grants: Record<string, ("read" | "draft")[]> = {},
): SocialAccount {
  return { id, platform, caps, grants } as unknown as SocialAccount;
}

export function capability(
  operation: Capability["operation"],
  status: Capability["status"] = "available",
  reasonCode = "api.ready",
  reason = "Ready",
): Capability {
  return { operation, status, reasonCode, reason, scopes: [], source: "test" };
}

export function contact(id: string, accountId: string, platformId: string, name: string) {
  return { id, accountId, platformId, name, tags: [], projectIds: [] } as unknown as SocialContact;
}

export function thread(
  overrides: Partial<SocialThread> & Pick<SocialThread, "id" | "accountId" | "contactId">,
): SocialThread {
  return {
    platformThreadId: `remote-${overrides.id}`,
    kind: "message",
    lastInboundAt: 0,
    events: [],
    ...overrides,
  } as SocialThread;
}

export const owner: SocialPrincipal = { kind: "owner", actorId: "owner", provider: "test" };

export type FixtureInput = {
  accounts?: SocialAccount[];
  contacts?: SocialContact[];
  threads?: SocialThread[];
  statuses?: InboxStatusRecord[];
  persons?: SocialPerson[];
  interactions?: Interaction[];
  principal?: SocialPrincipal;
  now?: number;
};

/**
 * Fake action context over in-memory maps. Only the members the inbox modules call are
 * implemented; everything else is absent on purpose, so an unexpected call fails loudly.
 */
export function inboxContext(input: FixtureInput = {}) {
  const principal = input.principal ?? owner;
  const accounts = input.accounts ?? [];
  const threads = input.threads ?? [];
  const contacts = input.contacts ?? [];
  const persons = input.persons ?? [];
  const interactions = input.interactions ?? [];
  const statuses = new Map((input.statuses ?? []).map((item) => [item.threadId, { ...item }]));
  const settings = new Map<string, string>();
  const writes: { key: string; value: string }[] = [];

  const service = {
    accounts: async (p: SocialPrincipal) =>
      accounts.filter(
        (item) =>
          p.kind === "owner" ||
          (item as unknown as { grants: Record<string, string[]> }).grants[
            p.projectId ?? ""
          ]?.includes("read"),
      ),
    owner: () => undefined,
    setting: async (key: string) => settings.get(key),
    setSetting: async (key: string, value: string) => {
      settings.set(key, value);
      writes.push({ key, value });
    },
  } as unknown as SocialServiceApi;

  const store = {
    legacyRecords: async (kind: string) =>
      kind === "thread" ? threads : kind === "contact" ? contacts : [],
    getRecord: async (_kind: string, id: string) => statuses.get(id),
    putRecord: async (_kind: string, id: string, value: InboxStatusRecord) => {
      statuses.set(id, value);
      return value;
    },
    listRecords: async (_kind: string, input: { cursor?: string; limit?: number }) => {
      const rows = [...statuses.values()].sort((a, b) => a.threadId.localeCompare(b.threadId));
      const start = rows.findIndex((row) => row.threadId > (input.cursor ?? ""));
      const limit = input.limit ?? 50;
      const items = start < 0 ? [] : rows.slice(start, start + limit);
      const more = start >= 0 && start + limit < rows.length;
      return { items, next: more ? items.at(-1)?.threadId : undefined };
    },
    findPersonByHandle: async (accountId: string, platformId: string) =>
      persons.find((person) =>
        person.handles.some((h) => h.accountId === accountId && h.platformId === platformId),
      ),
    getPerson: async (id: string) => persons.find((person) => person.id === id),
    listInteractions: async (personId: string) =>
      interactions.filter((item) => item.personId === personId),
  } as unknown as SocialAudienceStore;

  const ctx: SocialActionContext = {
    service,
    store,
    now: () => input.now ?? 1_000_000,
    principal,
    operationId: "operation-test",
  };
  return { ctx, statuses, settings, writes };
}
