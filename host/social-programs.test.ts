import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { SocialService, type SocialPrincipal } from "./social";
import { platformRequirements } from "../src/integrations/social/capabilities";
import type { SocialAccount, SocialJob } from "../src/features/social/model/social";
import {
  defaultProgram,
  type ProgramDetail,
  type SocialProgram,
} from "../src/features/social/model/socialProgram";
import type { SocialAdapters } from "../src/integrations/social/adapter";
import type { SocialTextGenerator } from "./social-generation";
import { ImageGenerationError, type SocialImageAdapters } from "./social-images";
const owner: SocialPrincipal = { kind: "owner", actorId: "test-owner", provider: "owner" };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture(
  generate: SocialTextGenerator = async () =>
    JSON.stringify({
      text: "An owner-provided practical workflow",
      imagePrompt: "A simple workflow",
      factIds: [],
    }),
  images: SocialImageAdapters = {},
  disposalFailure?: (error: unknown) => void,
) {
  const directory = mkdtempSync(join(tmpdir(), "social-program-test-")),
    store = new HostStore(join(directory, "host.db"));
  const project = await store.addProject(directory, "Test project"),
    clock = { at: Date.parse("2026-10-14T09:00:00Z") };
  const send = vi.fn(async () => ({
    platformId: "external-test-id",
    url: "https://example.com/post",
  }));
  const adapters = Object.fromEntries(
    ["x", "instagram", "facebook", "linkedin", "youtube"].map((id) => [
      id,
      { send, poll: async () => ({ events: [] }) },
    ]),
  ) as SocialAdapters;
  const tokens = new Map<string, any>();
  const service = new SocialService(
    store,
    {
      get: async (id) => tokens.get(id),
      set: async (id, value) => {
        tokens.set(id, value);
      },
      delete: async (id) => {
        tokens.delete(id);
      },
    },
    adapters,
    directory,
    undefined,
    () => clock.at,
    generate,
    undefined,
    images,
  );
  cleanups.push(async () => {
    await service.dispose().catch((error) => {
      if (!disposalFailure) throw error;
      disposalFailure(error);
    });
    await service.programs.idle();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const call = async <T>(action: string, input: Record<string, unknown> = {}, principal = owner) =>
    (await service.call(principal, action, input)) as Promise<T>;
  const account = async (platform: SocialAccount["platform"] = "x") => {
    const a = await call<SocialAccount>("accounts.create", {
      platform,
      name: `${platform} account`,
      accountType:
        platform === "x" || platform === "linkedin"
          ? "member"
          : platform === "youtube"
            ? "channel"
            : platform === "facebook"
              ? "page"
              : "professional",
      projectIds: [project.id],
    });
    await service.connectAccount(
      a.id,
      {
        platformId: `${platform}-test`,
        name: a.name,
        scopes: [
          ...new Set(
            Object.values(platformRequirements(platform, a.accountType)).flatMap((r) => r.scopes),
          ),
        ],
        accessApproved: true,
      },
      { accessToken: "fixture-token", expiresAt: clock.at + 365 * 86400000 },
    );
    await call("accounts.grants", {
      accountId: a.id,
      projectId: project.id,
      permissions: ["read", "draft", "publish"],
    });
    return a;
  };
  const a = await account();
  const config = {
    ...defaultProgram(project.id, clock.at),
    name: "AI program",
    accountIds: [a.id],
    textAgent: { provider: "codex" as const, model: "selected-test-model" },
    brief: {
      topic: "Workflow",
      title: "Workflow",
      description: "An owner-provided practical workflow",
      audience: "Developers",
      language: "en",
      voice: "Helpful",
      cta: "",
      factIds: [],
    },
    approval: { mode: "automatic" as const, steps: [] },
    totalPosts: 1,
  };
  config.schedule.timeZone = "UTC";
  const create = async () => await call<SocialProgram>("programs.configure", { config });
  const activate = async (p: SocialProgram) =>
    await call<SocialProgram>("programs.activate", {
      id: p.id,
      expectedRevision: p.revision,
      confirm: true,
    });
  const detail = async (p: SocialProgram) =>
    await call<ProgramDetail>("programs.status", { id: p.id });
  return {
    service,
    store,
    clock,
    call,
    account,
    config,
    create,
    activate,
    detail,
    send,
    a,
    tokens,
  };
}
describe("AI campaign programs through SocialService", () => {
  it("keeps generation stopped when an older asynchronous start resumes after Stop", async () => {
    const generate = vi.fn(async () => JSON.stringify({ text: "Prepared content", factIds: [] }));
    const f = await fixture(generate);
    const program = await f.create();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.defineProperty(f.service.programs, "ready", { value: held });
    const starting = f.service.programs.start();
    const stopping = f.service.programs.stop();
    release();
    await Promise.all([starting, stopping]);
    await f.call("programs.generate", { id: program.id });
    await f.service.programs.idle();
    expect(generate).not.toHaveBeenCalled();
  });
  it("keeps owner pause/status controls after project draft grants are revoked", async () => {
    const f = await fixture(),
      p = await f.create();
    await f.call("accounts.grants", {
      accountId: f.a.id,
      projectId: f.config.projectId,
      permissions: [],
    });
    expect((await f.detail(p)).program.id).toBe(p.id);
    await f.call("programs.cancel", { id: p.id });
    expect((await f.detail(p)).program.cancelled).toBe(true);
  });
  it("does not persist repeated status reads as large idempotency receipts", async () => {
    const f = await fixture(),
      p = await f.create();
    const count = async () =>
      (await f.store.db.prepare("SELECT count(*) AS n FROM social_receipts").get())!.n;
    const before = await count();
    await f.service.call(owner, "programs.status", { id: p.id }, "read-request-one");
    await f.service.call(owner, "programs.status", { id: p.id }, "read-request-two");
    expect(await count()).toBe(before);
  });
  it("measures interval plans from the actual dispatch rather than their original slot", async () => {
    const f = await fixture(),
      account = await f.account("facebook");
    f.config.accountIds = [account.id];
    f.config.strategy = "repeat";
    f.config.totalPosts = 2;
    f.config.schedule.mode = "interval";
    f.config.schedule.minIntervalMinutes = 2;
    f.config.schedule.maxIntervalMinutes = 2;
    const p = await f.create();
    await f.activate(p);
    await f.call("programs.generate", { id: p.id });
    await f.service.programs.idle();
    await f.call("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" });
    f.clock.at += 60000;
    await f.service.tick();
    await f.service.programs.idle();
    f.clock.at += 60000;
    await f.service.tick();
    expect(f.send).toHaveBeenCalledTimes(1);
    f.clock.at += 60000;
    await f.service.tick();
    expect(f.send).toHaveBeenCalledTimes(2);
  });
  it("resumes a known ComfyUI image job without creating a new generation", async () => {
    let attempts = 0;
    const png = Buffer.alloc(32);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.write("IHDR", 12);
    png.writeUInt32BE(1024, 16);
    png.writeUInt32BE(1024, 20);
    const images: SocialImageAdapters = {
      comfyui: {
        capability: async () => ({
          provider: "comfyui",
          available: true,
          reason: "",
          models: ["fixture"],
        }),
        generate: async (input) => {
          attempts++;
          if (attempts === 1) {
            await input.checkpoint("known-image-job");
            throw new ImageGenerationError("uncertain", "Interrupted.");
          }
          expect(input.providerJobId).toBe("known-image-job");
          return { bytes: png, model: "fixture" };
        },
      },
    };
    const f = await fixture(undefined, images);
    f.config.image.mode = "generate";
    f.config.image.provider = "comfyui";
    const p = await f.create();
    await f.call("programs.generate", { id: p.id });
    await f.service.programs.idle();
    const first = await f.detail(p);
    expect(first.program.generationCount).toBe(2);
    await f.call("programs.resume-image", {
      id: p.id,
      occurrenceId: first.occurrences[0].id,
      accountId: f.a.id,
    });
    await f.service.programs.idle();
    const current = await f.detail(p);
    expect(current.program.generationCount).toBe(2);
    expect(current.occurrences[0].targets[0].variant?.media[0].uploadId).toBeTruthy();
  });
  it("stops generation durably and safely ignores a late model response", async () => {
    let resolve!: (value: string) => void;
    let entered!: () => void;
    const started = new Promise<void>((done) => {
      entered = done;
    });
    const f = await fixture(
        () =>
          new Promise<string>((yes) => {
            resolve = yes;
            entered();
          }),
      ),
      p = await f.create();
    await f.call("programs.generate", { id: p.id });
    await started;
    try {
      await f.service.stop();
      expect((await f.detail(p)).occurrences[0].targets[0].status).toBe("review");
    } finally {
      resolve(JSON.stringify({ text: "A late response", factIds: [] }));
      await f.service.programs.idle();
    }
    expect((await f.detail(p)).occurrences[0].targets[0].variant).toBeUndefined();
  });
  it("refreshes an expiring supported connection without invalidating program authority", async () => {
    const f = await fixture();
    const a = JSON.parse(
      String(
        (await f.store.db
          .prepare("SELECT value FROM social_records WHERE kind='account' AND id=?")
          .get(f.a.id))!.value,
      ),
    );
    a.expiresAt = f.clock.at + 500;
    await f.store.db
      .prepare("UPDATE social_records SET value=? WHERE kind='account' AND id=?")
      .run(JSON.stringify(a), a.id);
    f.tokens.set(a.id, {
      accessToken: "old-test-token",
      refreshToken: "test-refresh",
      expiresAt: a.expiresAt,
    });
    f.service.refreshCredential = vi.fn(async () => ({
      accessToken: "new-test-token",
      refreshToken: "test-refresh",
      expiresAt: f.clock.at + 3600000,
    }));
    const p = await f.create();
    await f.activate(p);
    await f.call("programs.generate", { id: p.id });
    await f.service.programs.idle();
    await f.call("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" });
    await f.service.tick();
    expect(f.service.refreshCredential).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.tokens.get(a.id).accessToken).toBe("new-test-token");
  });
  it("preserves another target's approvals while a second account is generating", async () => {
    let resolve!: (value: string) => void;
    let entered!: () => void;
    const secondStarted = new Promise<void>((done) => {
      entered = done;
    });
    let count = 0;
    const f = await fixture(async () => {
      count++;
      if (count === 1)
        return JSON.stringify({ text: "An owner-provided practical workflow", factIds: [] });
      return new Promise<string>((yes) => {
        resolve = yes;
        entered();
      });
    });
    const second = await f.account("facebook");
    f.config.accountIds.push(second.id);
    f.config.approval = { mode: "semi" as any, steps: ["text"] as any };
    const p = await f.create();
    await f.call("programs.generate", { id: p.id });
    // The first output has completed and the chained second target is now awaiting AI.
    await secondStarted;
    const o = (await f.detail(p)).occurrences[0];
    try {
      await f.call("programs.approve", {
        id: p.id,
        occurrenceId: o.id,
        accountId: f.a.id,
        expectedRevision: o.revision,
        confirm: true,
        steps: ["text"],
      });
    } finally {
      resolve(JSON.stringify({ text: "A different workflow perspective", factIds: [] }));
      await f.service.programs.idle();
    }
    expect((await f.detail(p)).occurrences[0].targets[0].approvals.text).toBeTruthy();
  });
  it("saves paused, generates through the chosen model and publishes an exact occurrence once", async () => {
    const generate = vi.fn(async () =>
      JSON.stringify({ text: "An owner-provided practical workflow", factIds: [] }),
    );
    const f = await fixture(generate),
      p = await f.create();
    expect(p.enabled).toBe(false);
    expect(p.authorization).toBeUndefined();
    await f.activate(p);
    await f.call("programs.generate", { id: p.id });
    await f.service.programs.idle();
    expect(generate.mock.calls[0][0]).toEqual(f.config.textAgent);
    expect(generate.mock.calls[0][1]).toContain("Effective policy");
    await f.call("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" });
    await f.service.tick();
    await f.service.tick();
    expect(f.send).toHaveBeenCalledTimes(1);
    const d = await f.detail(p);
    expect(d.occurrences[0].targets[0].platformId).toBe("external-test-id");
    expect(d.occurrences[0].targets[0].status).toBe("succeeded");
  });
  it("does not let a session activate or approve a program", async () => {
    const f = await fixture(),
      p = await f.create();
    expect(f.service.isTool("programs.activate")).toBe(false);
    expect(f.service.isTool("programs.approve")).toBe(false);
    await expect(
      f.call(
        "programs.activate",
        { id: p.id, expectedRevision: p.revision, confirm: true },
        {
          kind: "session",
          actorId: "fake",
          sessionId: "fake",
          projectId: f.config.projectId,
          provider: "codex",
        },
      ),
    ).rejects.toThrow();
  });
  it("requires explicit revision confirmation and preserves the external sending switch", async () => {
    const f = await fixture(),
      p = await f.create();
    await expect(
      f.call("programs.activate", { id: p.id, expectedRevision: 999, confirm: true }),
    ).rejects.toThrow("exact");
    await f.activate(p);
    await f.call("programs.generate", { id: p.id });
    await f.service.programs.idle();
    await f.service.tick();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("semi-approved mode requires the first sample and invalidates approval after editing", async () => {
    const f = await fixture();
    f.config.approval = { mode: "semi" as any, steps: ["text", "schedule"] as any };
    const p = await f.create();
    await expect(f.activate(p)).rejects.toThrow("sample");
    await f.call("programs.generate", { id: p.id });
    await f.service.programs.idle();
    let d = await f.detail(p),
      o = d.occurrences[0];
    await f.call("programs.approve", {
      id: p.id,
      occurrenceId: o.id,
      accountId: f.a.id,
      expectedRevision: o.revision,
      confirm: true,
      steps: ["text"],
    });
    await f.activate(p);
    await f.call("programs.edit", {
      id: p.id,
      occurrenceId: o.id,
      accountId: f.a.id,
      expectedRevision: o.revision,
      variant: { ...o.targets[0].variant, text: "Edited owner workflow" },
    });
    await f.call("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" });
    await f.service.tick();
    expect(f.send).not.toHaveBeenCalled();
    d = await f.detail(p);
    expect(d.occurrences[0].targets[0].approvals).toEqual({});
  });
  it("rechecks policy and account grants before dispatch", async () => {
    const f = await fixture(),
      p = await f.create();
    await f.activate(p);
    await f.call("programs.generate", { id: p.id });
    await f.service.programs.idle();
    await f.service.tick();
    await f.call("accounts.grants", {
      accountId: f.a.id,
      projectId: f.config.projectId,
      permissions: ["read", "draft"],
    });
    await f.call("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" });
    await f.service.tick();
    expect(f.send).not.toHaveBeenCalled();
    expect((await f.detail(p)).program.enabled).toBe(false);
  });
  it("allows pausing and resuming queued content without creating a second job", async () => {
    const f = await fixture(),
      p = await f.create();
    await f.activate(p);
    await f.call("programs.generate", { id: p.id });
    await f.service.programs.idle();
    await f.service.tick();
    const id = (await f.detail(p)).occurrences[0].targets[0].jobId;
    await f.call("programs.pause", { id: p.id });
    await f.call("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" });
    await f.service.tick();
    expect(f.send).not.toHaveBeenCalled();
    await f.activate(p);
    await f.service.tick();
    expect(f.send).toHaveBeenCalledTimes(1);
    expect((await f.detail(p)).occurrences[0].targets[0].jobId).toBe(id);
  });
  it("rejects X repeated content and requires publication review for LinkedIn", async () => {
    const f = await fixture();
    f.config.strategy = "repeat";
    await expect(f.create()).rejects.toThrow("X");
    const linked = await f.account("linkedin");
    f.config.accountIds = [linked.id];
    f.config.strategy = "unique";
    const p = await f.create();
    await f.activate(p);
    await f.call("programs.generate", { id: p.id });
    await f.service.programs.idle();
    await f.call("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" });
    await f.service.tick();
    expect(f.send).not.toHaveBeenCalled();
    const o = (await f.detail(p)).occurrences[0];
    await f.call("programs.approve", {
      id: p.id,
      occurrenceId: o.id,
      accountId: linked.id,
      expectedRevision: o.revision,
      confirm: true,
      steps: ["publish"],
    });
    await f.service.tick();
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("does not block publication ticks while generation is pending", async () => {
    let resolve!: (value: string) => void;
    let entered!: () => void;
    const started = new Promise<void>((done) => {
      entered = done;
    });
    const f = await fixture(
        () =>
          new Promise<string>((yes) => {
            resolve = yes;
            entered();
          }),
      ),
      p = await f.create();
    await f.activate(p);
    await f.call("programs.generate", { id: p.id });
    await started;
    try {
      await f.service.tick();
      expect((await f.detail(p)).occurrences[0].targets[0].status).toBe("generating");
    } finally {
      resolve(JSON.stringify({ text: "An owner-provided practical workflow", factIds: [] }));
      await f.service.programs.idle();
    }
  });
  it("enforces generation budgets and platform model overrides", async () => {
    const generate = vi.fn(async () =>
      JSON.stringify({ text: "An owner-provided practical workflow", factIds: [] }),
    );
    const f = await fixture(generate);
    await f.call("policy.save", {
      policies: {
        global: {},
        platforms: { x: { agent: { provider: "antigravity", model: "platform-override" } } },
      },
    });
    f.config.limits.totalGenerations = 1;
    const p = await f.create();
    await f.call("programs.generate", { id: p.id });
    await f.service.programs.idle();
    expect(generate.mock.calls[0][0]).toEqual({
      provider: "antigravity",
      model: "platform-override",
    });
    const o = (await f.detail(p)).occurrences[0];
    await f.call("programs.regenerate", { id: p.id, occurrenceId: o.id, accountId: f.a.id });
    await f.service.programs.idle();
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await f.detail(p)).occurrences[0].targets[0].error).toContain("budget");
  });
  it("records repeated approved content as different jobs on supported accounts", async () => {
    const f = await fixture();
    const facebook = await f.account("facebook");
    f.config.accountIds = [facebook.id];
    f.config.strategy = "repeat";
    f.config.totalPosts = 2;
    f.config.schedule.mode = "interval";
    f.config.schedule.minIntervalMinutes = 2;
    f.config.schedule.maxIntervalMinutes = 2;
    const p = await f.create();
    await f.activate(p);
    await f.call("programs.generate", { id: p.id });
    await f.service.programs.idle();
    await f.call("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" });
    await f.service.tick();
    await f.service.programs.idle();
    f.clock.at += 120000;
    await f.service.tick();
    expect(f.send).toHaveBeenCalledTimes(2);
    const d = await f.detail(p);
    expect(new Set(d.occurrences.map((o) => o.targets[0].jobId)).size).toBe(2);
  });
  it("holds unknown publication results without retrying them", async () => {
    const f = await fixture(),
      p = await f.create();
    f.send.mockRejectedValue(new Error("ambiguous network result"));
    await f.activate(p);
    await f.call("programs.generate", { id: p.id });
    await f.service.programs.idle();
    await f.call("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" });
    await f.service.tick();
    await f.service.tick();
    const d = await f.detail(p);
    expect(d.occurrences[0].targets[0].status).toBe("review");
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(d.program.enabled).toBe(false);
  });
  it("recovers interrupted generation to review and refuses stale content edits", async () => {
    const f = await fixture(),
      p = await f.create();
    await f.call("programs.generate", { id: p.id });
    await f.service.programs.idle();
    const d = await f.detail(p),
      o = d.occurrences[0];
    o.targets[0].status = "generating";
    await f.store.db
      .prepare("UPDATE social_occurrences SET value=? WHERE id=?")
      .run(JSON.stringify(o), o.id);
    await f.service.programs.recover();
    expect((await f.detail(p)).occurrences[0].targets[0].status).toBe("review");
    await expect(
      f.call("programs.edit", {
        id: p.id,
        occurrenceId: o.id,
        accountId: f.a.id,
        expectedRevision: 999,
        variant: o.targets[0].variant,
      }),
    ).rejects.toThrow("another session");
  });
  it("does not inherit sample approval when campaign settings change", async () => {
    const f = await fixture();
    f.config.approval = { mode: "semi" as any, steps: ["text"] as any };
    const p = await f.create();
    await f.call("programs.generate", { id: p.id });
    await f.service.programs.idle();
    const o = (await f.detail(p)).occurrences[0];
    await f.call("programs.approve", {
      id: p.id,
      occurrenceId: o.id,
      accountId: f.a.id,
      expectedRevision: o.revision,
      confirm: true,
      steps: ["text"],
    });
    f.config.brief.topic = "Different owner topic";
    const updated = await f.call<SocialProgram>("programs.configure", {
      id: p.id,
      expectedRevision: p.revision,
      config: f.config,
    });
    await expect(f.activate(updated)).rejects.toThrow("sample");
  });
});

it("rejects a stale activation after an acknowledged configuration replacement", async () => {
  const f = await fixture();
  const program = await f.create();
  const programs = f.service.programs as unknown as { checkConfig(config: unknown): Promise<void> };
  const original = programs.checkConfig.bind(programs);
  let entered!: () => void;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let hold = true;
  const check = vi.spyOn(programs, "checkConfig").mockImplementation(async (config) => {
    await original(config);
    if (hold && (config as SocialProgram).id === program.id) {
      hold = false;
      entered();
      await held;
    }
  });
  const activating = f.activate(program);
  try {
    await started;
    const updated = await f.call<SocialProgram>("programs.configure", {
      id: program.id,
      expectedRevision: program.revision,
      config: { ...f.config, name: "Newer paused campaign" },
    });
    release();
    await expect(activating).rejects.toThrow("Campaign was changed by another session");
    expect((await f.detail(program)).program).toMatchObject({
      revision: updated.revision,
      name: "Newer paused campaign",
      enabled: false,
    });
  } finally {
    release();
    await activating.catch(() => {});
    check.mockRestore();
  }
});

it("discards a stale publication tick after an acknowledged configuration replacement", async () => {
  const f = await fixture();
  const program = await f.create();
  await f.activate(program);
  await f.call("programs.generate", { id: program.id });
  await f.service.programs.idle();
  const hooks = (
    f.service.programs as unknown as { hooks: { prepareMedia(variant: any): Promise<any> } }
  ).hooks;
  const original = hooks.prepareMedia.bind(hooks);
  let entered!: () => void;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let hold = true;
  const media = vi.spyOn(hooks, "prepareMedia").mockImplementation(async (variant) => {
    const prepared = await original(variant);
    if (hold) {
      hold = false;
      entered();
      await held;
    }
    return prepared;
  });
  const ticking = f.service.programs.tick();
  try {
    await started;
    const updated = await f.call<SocialProgram>("programs.configure", {
      id: program.id,
      expectedRevision: program.revision,
      config: { ...f.config, name: "Newer paused campaign" },
    });
    release();
    await ticking;
    const detail = await f.detail(program);
    expect(detail.program).toMatchObject({
      revision: updated.revision,
      name: "Newer paused campaign",
      enabled: false,
    });
    expect(detail.occurrences[0].programRevision).toBe(updated.revision);
    expect(detail.occurrences[0].targets[0]).toMatchObject({ status: "pending" });
    expect((await f.store.db.prepare("SELECT count(*) AS n FROM social_jobs").get())!.n).toBe(0);
    expect(f.send).not.toHaveBeenCalled();
  } finally {
    release();
    await ticking.catch(() => {});
    media.mockRestore();
  }
});

it("rejects a held earlier edit after a newer program configuration acknowledges", async () => {
  const f = await fixture();
  const program = await f.create();
  const programs = f.service.programs as unknown as {
    occurrences(id: string, limit?: number): Promise<unknown[]>;
  };
  const original = programs.occurrences.bind(programs);
  let release!: () => void;
  let entered!: () => void;
  let hold = true;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const read = vi.spyOn(programs, "occurrences").mockImplementation(async (...args) => {
    if (hold && args[0] === program.id) {
      hold = false;
      entered();
      await gate;
    }
    return await original(...args);
  });
  const first = f.call<SocialProgram>("programs.configure", {
    id: program.id,
    expectedRevision: program.revision,
    config: { ...f.config, name: "Earlier slow edit" },
  });
  try {
    await started;
    const second = await f.call<SocialProgram>("programs.configure", {
      id: program.id,
      expectedRevision: program.revision,
      config: { ...f.config, name: "Newer acknowledged edit" },
    });
    expect(second.revision).toBe(program.revision + 1);
    release();
    await expect(first).rejects.toThrow("Campaign was changed by another session");
    expect((await f.detail(program)).program.name).toBe("Newer acknowledged edit");
  } finally {
    release();
    await first.catch(() => {});
    read.mockRestore();
  }
});
it("keeps failed generation cleanup atomic with an acknowledged configuration replacement", async () => {
  let rejectModel!: (error: Error) => void;
  let modelEntered!: () => void;
  const modelStarted = new Promise<void>((resolve) => {
    modelEntered = resolve;
  });
  const f = await fixture(
    () =>
      new Promise<string>((_resolve, reject) => {
        rejectModel = reject;
        modelEntered();
      }),
  );
  const program = await f.create();
  await f.call("programs.generate", { id: program.id });
  await modelStarted;
  const occurrenceId = (await f.detail(program)).occurrences[0].id;
  const programs = f.service.programs as unknown as { occurrence(id: unknown): Promise<any> };
  const original = programs.occurrence.bind(programs);
  let release!: () => void;
  let entered!: () => void;
  let hold = true;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const read = vi.spyOn(programs, "occurrence").mockImplementation(async (id) => {
    const item = await original(id);
    if (hold && id === occurrenceId) {
      hold = false;
      entered();
      await gate;
    }
    return item;
  });
  rejectModel(new Error("fixture model failure"));
  try {
    await started;
    let configureSettled = false;
    const configuring = f.call<SocialProgram>("programs.configure", {
      id: program.id,
      expectedRevision: program.revision,
      config: { ...f.config, name: "Reconfigured after generation failure" },
    });
    void configuring.then(() => {
      configureSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(configureSettled).toBe(false);
    release();
    const updated = await configuring;
    await f.service.programs.idle();
    const after = await original(occurrenceId);
    expect(after.programRevision).toBe(updated.revision);
    expect(after.targets[0].status).toBe("pending");
  } finally {
    release();
    await f.service.programs.idle();
    read.mockRestore();
  }
});

it("drains accepted Social operations before reporting a Stop failure during disposal", async () => {
  let releaseModel!: (value: string) => void;
  let modelEntered!: () => void;
  const modelStarted = new Promise<void>((resolve) => {
    modelEntered = resolve;
  });
  const stopFailure = new Error("fixture stop SQLite failure");
  const f = await fixture(
    () =>
      new Promise<string>((resolve) => {
        releaseModel = resolve;
        modelEntered();
      }),
    {},
    (error) => {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toContain(stopFailure);
    },
  );
  const operation = f.call("programs.suggest", { config: f.config, instructions: "retain config" });
  const caught = operation.catch((error) => error);
  await modelStarted;
  const stop = vi.spyOn(f.service.programs, "stop").mockRejectedValueOnce(stopFailure);
  let operationSettled = false;
  void caught.then(() => {
    operationSettled = true;
  });
  const disposing = f.service.dispose();
  let disposed = false;
  void disposing.then(
    () => {
      disposed = true;
    },
    () => {
      disposed = true;
    },
  );
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(disposed).toBe(false);
    expect(operationSettled).toBe(false);
    releaseModel(JSON.stringify({ config: f.config, questions: [] }));
    await caught;
    await expect(disposing).rejects.toThrow("Social shutdown failed after draining accepted work");
  } finally {
    releaseModel(JSON.stringify({ config: f.config, questions: [] }));
    await caught;
    await disposing.catch(() => {});
    stop.mockRestore();
  }
});
