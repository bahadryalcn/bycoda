import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HostStore } from "../../store";
import { SocialService, type SocialPrincipal } from "../social";
import type { SocialCredentialStore } from "../social-credentials";
import { SOCIAL_PLATFORMS } from "../../../src/features/social/model/social";
import { SocialPlatformError, type SocialAdapters } from "../../../src/integrations/social/adapter";
import {
  plannedSocialAction,
  SOCIAL_LEGACY_ACTIONS,
  socialActionRegistry,
  type SocialActionContext,
  type SocialActionModule,
  type SocialActionSpec,
} from "./social-actions";
import type { DecisionService } from "../../decision-models/decision-types";
import { SOCIAL_ACTION_MODULES } from "./social-action-modules";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const owner: SocialPrincipal = { kind: "owner", actorId: "owner-device", provider: "owner" };

const spec = (overrides: Partial<SocialActionSpec> = {}): SocialActionSpec => ({
  readOnly: false,
  ownerOnly: false,
  run: async () => ({ ok: true }),
  ...overrides,
});

describe("socialActionRegistry", () => {
  it("routes each registered name to its own spec", () => {
    const first = spec();
    const second = spec({ readOnly: true });
    const modules: SocialActionModule[] = [
      { "fixture.first": first },
      { "fixture.second": second },
    ];
    const registry = socialActionRegistry(modules);
    expect(registry.get("fixture.first")).toBe(first);
    expect(registry.get("fixture.second")).toBe(second);
    expect(registry.get("fixture.missing")).toBeUndefined();
  });

  it("throws when one action name appears in two modules", () => {
    expect(() =>
      socialActionRegistry([{ "fixture.dup": spec() }, { "fixture.dup": spec() }]),
    ).toThrow("Social action fixture.dup is registered twice.");
  });

  it("throws when a name is already handled by the built-in dispatch switch", () => {
    expect(() => socialActionRegistry([{ "thread.read": spec() }])).toThrow(
      "Social action thread.read collides with a built-in operation.",
    );
    expect(() => socialActionRegistry([{ "programs.custom": spec() }])).toThrow(
      "collides with a built-in operation",
    );
  });

  it("accepts every planned Phase 3 module without a duplicate", () => {
    const names = SOCIAL_ACTION_MODULES.flatMap((module) => Object.keys(module));
    expect(new Set(names).size).toBe(names.length);
    expect(socialActionRegistry(SOCIAL_ACTION_MODULES).size).toBe(names.length);
  });

  it("keeps the legacy name list in step with the dispatch switch in social.ts", () => {
    const source = readFileSync(fileURLToPath(new URL("../social.ts", import.meta.url)), "utf8");
    const dispatched = new Set<string>();
    for (const match of source.matchAll(/case "([a-z][\w-]*\.[\w.-]+)"/g)) dispatched.add(match[1]);
    for (const match of source.matchAll(/action === "([a-z][\w-]*\.[\w.-]+)"/g))
      dispatched.add(match[1]);
    for (const name of dispatched) expect(SOCIAL_LEGACY_ACTIONS).toContain(name);
    for (const name of SOCIAL_LEGACY_ACTIONS.filter((item) => !item.startsWith("programs.")))
      expect(source.includes(`case "${name}"`) || source.includes(`action === "${name}"`)).toBe(
        true,
      );
  });
});

describe("plannedSocialAction", () => {
  it("keeps its flags and rejects every call as unsupported", async () => {
    const planned = plannedSocialAction({ readOnly: true, ownerOnly: false, tool: true });
    expect(planned).toMatchObject({ readOnly: true, ownerOnly: false, tool: true });
    const rejection = await planned.run({} as never, {}).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(SocialPlatformError);
    expect((rejection as SocialPlatformError).code).toBe("unsupported");
  });
});

async function fixture(decisions?: DecisionService) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-social-actions-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = await store.addProject(directory, "A");
  const credentials: SocialCredentialStore = {
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  const adapters = Object.fromEntries(
    SOCIAL_PLATFORMS.map((platform) => [
      platform,
      {
        send: vi.fn(async () => ({ platformId: "post", url: "https://example.com/post" })),
        poll: vi.fn(async () => ({ events: [] })),
      },
    ]),
  ) as unknown as SocialAdapters;
  const social = new SocialService(
    store,
    credentials,
    adapters,
    directory,
    undefined,
    () => Date.parse("2026-11-07T09:00:00Z"),
    undefined,
    undefined,
    undefined,
    decisions,
  );
  cleanups.push(async () => {
    await social.dispose();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const registry = (social as unknown as { actions: Map<string, SocialActionSpec> }).actions;
  const receipts = async () =>
    Number((await store.db.prepare("SELECT COUNT(*) AS n FROM social_receipts").get())?.n);
  return {
    social,
    store,
    registry,
    receipts,
    external: {
      kind: "external",
      projectId: project.id,
      actorId: "external-worker",
      provider: "test",
    } as SocialPrincipal,
  };
}

describe("SocialService action dispatch", () => {
  it("rejects a non-owner call to an owner-only registry action", async () => {
    const s = await fixture();
    await expect(s.social.call(s.external, "people.export", {})).rejects.toThrow(
      "Only the account owner",
    );
  });

  it("sends an owner call to a planned registry action to its unsupported stub", async () => {
    const s = await fixture();
    s.registry.set("fixture.planned", plannedSocialAction({ readOnly: false, ownerOnly: true }));
    await expect(s.social.call(owner, "fixture.planned", {})).rejects.toMatchObject({
      code: "unsupported",
    });
  });

  it("keeps the existing error for an unknown action", async () => {
    const s = await fixture();
    await expect(s.social.call(owner, "nope.unknown", {})).rejects.toThrow(
      "Unsupported social operation.",
    );
  });

  it("writes no receipt for a read-only registry action and runs it again on retry", async () => {
    const s = await fixture();
    let runs = 0;
    s.registry.set("fixture.readOnly", {
      readOnly: true,
      ownerOnly: false,
      run: async () => {
        runs++;
        return { ok: true };
      },
    });
    await s.social.call(owner, "fixture.readOnly", {}, "request-read");
    await s.social.call(owner, "fixture.readOnly", {}, "request-read");
    expect(runs).toBe(2);
    expect(await s.receipts()).toBe(0);
  });

  it("replays a write registry action from its receipt on a retried request ID", async () => {
    const s = await fixture();
    let runs = 0;
    s.registry.set("fixture.write", {
      readOnly: false,
      ownerOnly: false,
      run: async () => {
        runs++;
        return { ok: true };
      },
    });
    const first = await s.social.call(owner, "fixture.write", {}, "request-write");
    const second = await s.social.call(owner, "fixture.write", {}, "request-write");
    expect(second).toEqual(first);
    expect(runs).toBe(1);
    expect(await s.receipts()).toBe(1);
  });

  it("hands the decision service and the new API methods to registry actions", async () => {
    const decisions: DecisionService = {
      decide: vi.fn(async () => ({ answers: {}, sourceChain: [], durationMs: 0 })),
    };
    const withModels = await fixture(decisions);
    const without = await fixture();
    const seen: SocialActionContext[] = [];
    for (const s of [withModels, without])
      s.registry.set("fixture.ctx", {
        readOnly: true,
        ownerOnly: false,
        run: async (ctx) => {
          seen.push(ctx);
          return { ok: true };
        },
      });
    await withModels.social.call(owner, "fixture.ctx", {});
    await without.social.call(owner, "fixture.ctx", {});
    expect(seen[0].decisions).toBe(decisions);
    expect(seen[1].decisions).toBeUndefined();
    const service = seen[0].service;
    expect(typeof service.contact).toBe("function");
    expect(typeof service.assertSendable).toBe("function");
    expect(typeof service.authorizeAutonomous).toBe("function");
    expect(typeof service.recordAiAction).toBe("function");
    await expect(service.contact("missing-contact")).resolves.toBeUndefined();
  });

  it("exposes only registry actions flagged as tools to the MCP surface", async () => {
    const s = await fixture();
    s.registry.set("fixture.tool", { ...spec(), tool: true });
    s.registry.set("fixture.notTool", spec());
    expect(s.social.isTool("social.fixture.tool")).toBe(true);
    expect(s.social.isTool("social.fixture.notTool")).toBe(false);
    expect(s.social.isTool("social.people.list")).toBe(true);
    expect(s.social.isTool("social.people.delete")).toBe(false);
  });
});
