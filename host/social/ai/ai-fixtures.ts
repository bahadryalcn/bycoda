import { vi } from "vitest";
import type { AiAction, AutonomyPolicy } from "../../../src/features/social/model/autonomy";
import type { SocialAccount } from "../../../src/features/social/model/social";
import type { SocialActionContext } from "../core/social-actions";
import type { SocialPrincipal } from "../social";

/** Test-only fixtures: a fake SocialService and store that the real gates and helpers run against. */
export const NOW = Date.parse("2026-11-07T12:00:00Z");

export const OWNER: SocialPrincipal = { kind: "owner", actorId: "owner", provider: "owner" };
export const AI_PRINCIPAL: SocialPrincipal = {
  kind: "session",
  actorId: "rule:r1",
  provider: "codex",
};

export function account(id: string, platform = "x"): SocialAccount {
  return { id, platform, name: `${platform} ${id}` } as unknown as SocialAccount;
}

export function makeKit(
  options: {
    principal?: SocialPrincipal;
    accounts?: SocialAccount[];
    agent?: boolean;
    modelReply?: unknown;
    policies?: Record<string, AutonomyPolicy>;
    aiActions?: AiAction[];
    call?: (...args: unknown[]) => Promise<unknown>;
  } = {},
) {
  const settings = new Map<string, string>();
  const records = new Map<string, unknown>(Object.entries(options.policies ?? {}));
  const actions = new Map<string, AiAction>(
    (options.aiActions ?? []).map((item) => [item.id, item]),
  );
  const call = vi.fn(options.call ?? (async () => ({ ok: true })));
  const generateText = vi.fn(async () => JSON.stringify(options.modelReply ?? { steps: [] }));
  const service = {
    setting: vi.fn(async (key: string) => settings.get(key)),
    setSetting: vi.fn(async (key: string, value: string) => {
      settings.set(key, value);
    }),
    accounts: vi.fn(async () => options.accounts ?? [account("a1")]),
    access: vi.fn(async (_principal: SocialPrincipal, id: string) => account(id)),
    call,
    policy: vi.fn(async () => (options.agent === false ? {} : { agent: { provider: "codex" } })),
    generateText: options.agent === false ? undefined : generateText,
  };
  const store = {
    getRecord: vi.fn(async (kind: string, id: string) =>
      kind === "autonomy" ? records.get(id) : undefined,
    ),
    putAiAction: vi.fn(async (item: AiAction) => {
      actions.set(item.id, item);
      return item;
    }),
    listAiActions: vi.fn(async () => ({ items: [...actions.values()] })),
    listPeople: vi.fn(async () => ({ items: [] })),
    listInteractions: vi.fn(async () => []),
  };
  const ctx = {
    service,
    store,
    now: () => NOW,
    principal: options.principal ?? OWNER,
    operationId: "operation-1",
  } as unknown as SocialActionContext;
  return { ctx, service, store, settings, records, actions, call, generateText };
}
