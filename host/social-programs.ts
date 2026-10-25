import { everyAsync, filterAsync, flatMapAsync, mapAsync, someAsync } from "./async-collections";
import { createHash, randomUUID } from "node:crypto";
import type { HostStore } from "./store";
import type { SocialPrincipal } from "./social";
import type {
  CampaignVariant,
  PublicFact,
  SocialAccount,
  SocialAgent,
  SocialJob,
  SocialPolicy,
} from "../src/features/social/model/social";
import type {
  ProgramConfig,
  ProgramDetail,
  ProgramStep,
  ProgramTarget,
  SocialOccurrence,
  SocialProgram,
  ProgramFeatures,
} from "../src/features/social/model/socialProgram";
import {
  PROGRAM_STEPS,
  SOCIAL_PROGRAM_CAPABILITY,
  programGeneratesImage,
} from "../src/features/social/model/socialProgram";
import {
  parseProgramConfig,
  nearDuplicate,
  validateGeneratedClaims,
} from "./social-program-config";
import {
  followingProgramSlot,
  nextProgramSlot,
  previewProgramSchedule,
  programDay,
} from "./social-program-schedule";
import { socialCharacterCount, socialLimit } from "../src/features/social/model/socialPolicy";
import type { SocialTextGenerator } from "./social-generation";
import {
  generateSocialImage,
  ImageGenerationError,
  validateGeneratedImage,
  type SocialImageAdapters,
} from "./social-images";
const signature = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(v) ?? "null")
    .digest("hex");
const publicProgram = (p: SocialProgram): SocialProgram => {
  const { authorization: _, ...safe } = p;
  return safe;
};
export type ProgramHooks = {
  account: (id: string) => SocialAccount | Promise<SocialAccount>;
  validateAccount: (id: string, needsMedia: boolean) => void | Promise<void>;
  policy: (id: string, agent?: SocialAgent) => SocialPolicy | Promise<SocialPolicy>;
  facts: (projectId: string, ids: string[]) => PublicFact[] | Promise<PublicFact[]>;
  pool: (
    id: string,
    accountId: string,
    projectId: string,
  ) => CampaignVariant | Promise<CampaignVariant>;
  validateVariant: (v: CampaignVariant, partial?: boolean) => void | Promise<void>;
  prepareMedia: (v: CampaignVariant) => CampaignVariant | Promise<CampaignVariant>;
  enqueue: (
    p: SocialProgram,
    o: SocialOccurrence,
    t: ProgramTarget,
  ) => SocialJob | Promise<SocialJob>;
  job: (id: string) => SocialJob | Promise<SocialJob>;
  cancelJob: (id: string) => void | Promise<void>;
  dispatchTimes: (
    programId: string,
    accountId: string,
    since: number,
  ) =>
    | {
        lastAt: number;
        recent: number[];
      }
    | Promise<{
        lastAt: number;
        recent: number[];
      }>;
  accountQueued: (accountId: string) => boolean | Promise<boolean>;
  media: (
    bytes: Uint8Array,
    actorId: string,
  ) => Promise<{
    uploadId: string;
    url?: string;
  }>;
  running: () => boolean | Promise<boolean>;
};
class ProgramStateChanged extends Error {}
/** Program records produce exact campaigns and existing SocialJobs; they never send.
 * The same authorization signature is checked again by SocialService.execute. */
export class SocialPrograms {
  private readonly programRows = new WeakMap<SocialProgram, string>();
  private readonly occurrenceRows = new WeakMap<SocialOccurrence, string>();
  private programRow(value: unknown): SocialProgram {
    const raw = String(value);
    const program = JSON.parse(raw) as SocialProgram;
    this.programRows.set(program, raw);
    return program;
  }
  private occurrenceRow(value: unknown): SocialOccurrence {
    const raw = String(value);
    const occurrence = JSON.parse(raw) as SocialOccurrence;
    this.occurrenceRows.set(occurrence, raw);
    return occurrence;
  }
  private active?: {
    programId: string;
    occurrenceId: string;
    accountId: string;
    leaseId: string;
    leaseOwner: string;
    controller: AbortController;
    promise: Promise<void>;
  };
  private closed = false;
  private lifecycleEpoch = 0;
  readonly ready: Promise<void>;
  constructor(
    private store: HostStore,
    private hooks: ProgramHooks,
    private generateText: SocialTextGenerator | undefined,
    private images: SocialImageAdapters,
    private now = Date.now,
  ) {
    this.ready = (async () => {
      await store.ready;
      await store.db.scope(async () => {
        await store.db
          .exec(`CREATE TABLE IF NOT EXISTS social_programs (id TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS social_occurrences (id TEXT PRIMARY KEY,program_id TEXT NOT NULL,sequence INTEGER NOT NULL,value TEXT NOT NULL,UNIQUE(program_id,sequence));
      CREATE INDEX IF NOT EXISTS social_occurrences_program ON social_occurrences(program_id,sequence);
      CREATE TABLE IF NOT EXISTS social_generation_leases (id TEXT PRIMARY KEY,executor_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS social_occurrences_active ON social_occurrences(program_id,json_extract(value,'$.programRevision'),coalesce(json_extract(value,'$.settled'),0),json_extract(value,'$.scheduledAt'));
      CREATE INDEX IF NOT EXISTS social_jobs_program_dispatch ON social_jobs(account_id,json_extract(value,'$.programId'),json_extract(value,'$.dispatchedAt'));`);
      });
    })();
  }
  private async putProgram(p: SocialProgram) {
    const before = this.programRows.get(p);
    const value = JSON.stringify(p);
    if (before === undefined)
      await this.store.db.prepare("INSERT INTO social_programs VALUES (?,?)").run(p.id, value);
    else {
      const result = await this.store.db
        .prepare("UPDATE social_programs SET value=? WHERE id=? AND value=?")
        .run(value, p.id, before);
      if (Number(result.changes) !== 1)
        throw new ProgramStateChanged("Campaign was changed by another session.");
    }
    this.programRows.set(p, value);
    return p;
  }
  private async putOccurrence(o: SocialOccurrence) {
    o.settled = o.targets.every((t) => t.status === "succeeded" || t.status === "cancelled");
    const before = this.occurrenceRows.get(o);
    const value = JSON.stringify(o);
    if (before === undefined)
      await this.store.db
        .prepare("INSERT INTO social_occurrences VALUES (?,?,?,?)")
        .run(o.id, o.programId, o.sequence, value);
    else {
      const result = await this.store.db
        .prepare("UPDATE social_occurrences SET value=? WHERE id=? AND value=?")
        .run(value, o.id, before);
      if (Number(result.changes) !== 1)
        throw new ProgramStateChanged("Content was changed by another session.");
    }
    this.occurrenceRows.set(o, value);
    return o;
  }
  private async get(id: unknown): Promise<SocialProgram> {
    if (typeof id !== "string") throw new Error("Choose a campaign program.");
    const row = await this.store.db.prepare("SELECT value FROM social_programs WHERE id=?").get(id);
    if (!row) throw new Error("Campaign program not found.");
    return this.programRow(row.value);
  }
  private async occurrence(id: unknown): Promise<SocialOccurrence> {
    if (typeof id !== "string") throw new Error("Choose a sharing occurrence.");
    const row = await this.store.db
      .prepare("SELECT value FROM social_occurrences WHERE id=?")
      .get(id);
    if (!row) throw new Error("Sharing occurrence not found.");
    return this.occurrenceRow(row.value);
  }
  private async occurrences(id: string, limit?: number): Promise<SocialOccurrence[]> {
    if (limit !== undefined)
      return (
        await this.store.db
          .prepare(
            "SELECT value FROM social_occurrences WHERE program_id=? ORDER BY sequence DESC LIMIT ?",
          )
          .all(id, limit)
      )
        .map((row) => this.occurrenceRow(row.value))
        .reverse();
    return (
      await this.store.db
        .prepare("SELECT value FROM social_occurrences WHERE program_id=? ORDER BY sequence")
        .all(id)
    ).map((row) => this.occurrenceRow(row.value));
  }
  private async firstOccurrence(p: SocialProgram): Promise<SocialOccurrence | undefined> {
    const row = await this.store.db
      .prepare(
        "SELECT value FROM social_occurrences WHERE program_id=? AND json_extract(value,'$.programRevision')=? ORDER BY sequence LIMIT 1",
      )
      .get(p.id, p.revision);
    return row ? this.occurrenceRow(row.value) : undefined;
  }
  private async activeOccurrences(id: string, revision: number): Promise<SocialOccurrence[]> {
    return (
      await this.store.db
        .prepare(
          "SELECT value FROM social_occurrences WHERE program_id=? AND json_extract(value,'$.programRevision')=? AND coalesce(json_extract(value,'$.settled'),0)=0 ORDER BY sequence",
        )
        .all(id, revision)
    ).map((row) => this.occurrenceRow(row.value));
  }
  private async programs(activeOnly = false): Promise<SocialProgram[]> {
    return (
      await this.store.db
        .prepare(
          activeOnly
            ? "SELECT value FROM social_programs WHERE json_extract(value,'$.enabled')=1 ORDER BY coalesce((SELECT min(json_extract(o.value,'$.scheduledAt')) FROM social_occurrences o WHERE o.program_id=social_programs.id AND json_extract(o.value,'$.programRevision')=json_extract(social_programs.value,'$.revision') AND coalesce(json_extract(o.value,'$.settled'),0)=0),json_extract(value,'$.nextAt')),id"
            : "SELECT value FROM social_programs ORDER BY id",
        )
        .all()
    ).map((row) => this.programRow(row.value));
  }
  private async allowed(actor: SocialPrincipal, p: ProgramConfig, write = false) {
    await this.store.project(p.projectId);
    if (actor.kind === "owner" && !write) return;
    if (actor.kind !== "owner" && actor.projectId !== p.projectId)
      throw new Error("Program belongs to another project.");
    for (const id of p.accountIds) {
      const account = await this.hooks.account(id);
      if (!account.grants[p.projectId]?.includes(write ? "draft" : "read"))
        throw new Error("Project account access is missing.");
    }
  }
  private owner(actor: SocialPrincipal) {
    if (actor.kind !== "owner")
      throw new Error("Only the owner can approve or activate a campaign program.");
  }
  private async checkConfig(c: ProgramConfig) {
    if (c.strategy === "pool" && c.image.mode === "generate")
      throw new Error(
        "Approved content pools reuse their exact text and media. Choose unique/repeat content to generate new images.",
      );
    await this.hooks.facts(c.projectId, c.brief.factIds);
    for (const id of c.accountIds) {
      const a = await this.hooks.account(id);
      if (c.strategy !== "unique" && a.platform === "x")
        throw new Error(
          "X does not permit automated duplicate or substantially similar posts. Choose unique content.",
        );
      if (c.strategy === "pool")
        for (const poolId of c.poolCampaignIds) await this.hooks.pool(poolId, id, c.projectId);
      const media = c.mediaOverrides?.[id] ?? (c.image.mode === "existing" ? c.image.media : []);
      if (
        a.platform === "youtube" &&
        c.strategy !== "pool" &&
        (media.length !== 1 || media[0].kind !== "video" || !c.youtube)
      )
        throw new Error("YouTube requires an uploaded video and explicit video declarations.");
      const policy = await this.hooks.policy(id, c.textAgent);
      if (c.strategy !== "pool" && !policy.agent)
        throw new Error(
          "Choose a text model or save an effective account agent before generation.",
        );
    }
  }
  private configOf(p: SocialProgram): ProgramConfig {
    const {
      id: _,
      revision: __,
      enabled: ___,
      cancelled: ____,
      reason: _____,
      createdAt: ______,
      updatedAt: _______,
      executorId: ________,
      generationCount: _________,
      imageGenerationCount: __________,
      generationDay: ___________,
      dailyGenerationCount: ____________,
      nextSequence: _____________,
      nextAt: ______________,
      authorization: _______________,
      ...config
    } = p;
    return config;
  }
  private async authorizationSignature(p: SocialProgram) {
    return signature({
      config: this.configOf(p),
      executorId: p.executorId,
      accounts: await mapAsync(p.accountIds, async (id) => {
        const { expiresAt: _, ...identity } = await this.hooks.account(id);
        return identity;
      }),
      policies: await mapAsync(
        p.accountIds,
        async (id) => await this.hooks.policy(id, p.textAgent),
      ),
      facts: await this.hooks.facts(p.projectId, p.brief.factIds),
      pool:
        p.strategy === "pool"
          ? await flatMapAsync(
              p.poolCampaignIds,
              async (id) =>
                await mapAsync(
                  p.accountIds,
                  async (account) => await this.hooks.pool(id, account, p.projectId),
                ),
            )
          : [],
    });
  }
  private async checkActive(p: SocialProgram) {
    if (p.schedule.endsAt !== undefined && this.now() > p.schedule.endsAt)
      throw new Error("Campaign end time reached. Review unfinished targets before continuing.");
    if (
      !p.enabled ||
      p.cancelled ||
      p.executorId !== this.store.environmentId ||
      !p.authorization ||
      p.authorization.revision !== p.revision ||
      p.authorization.signature !== (await this.authorizationSignature(p))
    )
      throw new Error(
        "Campaign authority, policy or configuration changed. Review and activate again.",
      );
    for (const id of p.accountIds) {
      const a = await this.hooks.account(id);
      await this.hooks.validateAccount(
        id,
        programGeneratesImage(p, id) ||
          !!(
            p.mediaOverrides?.[id]?.length ??
            (p.image.mode === "existing" ? p.image.media.length : 0)
          ),
      );
      if (
        !a.connected ||
        a.paused ||
        a.executorId !== this.store.environmentId ||
        !a.grants[p.projectId]?.includes("publish") ||
        !a.grants[p.projectId]?.includes("draft")
      )
        throw new Error("Account connection, executor or publication grant is unavailable.");
    }
  }
  private stepSignature(o: SocialOccurrence, t: ProgramTarget, step: ProgramStep) {
    const media = t.variant?.media.map(({ url, ...asset }) =>
      asset.uploadId ? asset : { ...asset, url },
    );
    const content = t.variant ? { ...t.variant, media } : undefined;
    return signature({
      programRevision: o.programRevision,
      step,
      value:
        step === "text"
          ? { text: t.variant?.text, facts: t.variant?.factIds, link: t.variant?.link }
          : step === "image"
            ? media
            : step === "schedule"
              ? o.scheduledAt
              : content,
    });
  }
  private async required(
    p: SocialProgram,
    o: SocialOccurrence,
    t: ProgramTarget,
  ): Promise<ProgramStep[]> {
    const first = (
      await this.store.db
        .prepare(
          "SELECT sequence FROM social_occurrences WHERE program_id=? AND json_extract(value,'$.programRevision')=? ORDER BY sequence LIMIT 1",
        )
        .get(p.id, p.revision)
    )?.sequence;
    const usesMedia = programGeneratesImage(p, t.accountId) || !!t.variant?.media.length;
    const steps = p.approval.steps.filter(
      (s) =>
        (s !== "schedule" || p.approval.mode !== "semi") &&
        (s !== "image" || usesMedia) &&
        (p.approval.mode !== "semi" || o.sequence === first || s === "publish"),
    );
    if (t.platform === "linkedin" && !steps.includes("publish")) steps.push("publish");
    return steps;
  }
  private async missing(p: SocialProgram, o: SocialOccurrence, t: ProgramTarget) {
    return (await this.required(p, o, t)).filter(
      (s) => t.approvals[s] !== this.stepSignature(o, t, s),
    );
  }
  private async addOccurrence(p: SocialProgram, at: number) {
    return this.store.transaction(async () => {
      const sequence = p.nextSequence;
      const o: SocialOccurrence = {
        id: `${p.id}:${sequence}`,
        programId: p.id,
        programRevision: p.revision,
        sequence,
        scheduledAt: at,
        originalAt: at,
        revision: 1,
        targets: await mapAsync(p.accountIds, async (accountId) => ({
          accountId,
          platform: (await this.hooks.account(accountId)).platform,
          status: "pending",
          approvals: {},
          generation: { attempts: 0, transitions: [] },
        })),
      };
      await this.putOccurrence(o);
      p.nextSequence++;
      p.nextAt = followingProgramSlot(p.schedule, at, p.id, p.nextSequence);
      await this.putProgram(p);
      return o;
    });
  }
  private async detail(p: SocialProgram, before?: number): Promise<ProgramDetail> {
    const all: SocialOccurrence[] = (
        await this.store.db
          .prepare(
            "SELECT value FROM social_occurrences WHERE program_id=? AND sequence<? ORDER BY sequence DESC LIMIT 51",
          )
          .all(p.id, before ?? Number.MAX_SAFE_INTEGER)
      )
        .map((row) => this.occurrenceRow(row.value))
        .reverse(),
      page = all.slice(-50);
    for (const o of page)
      for (const t of o.targets)
        if (t.jobId) {
          const job = await this.hooks.job(t.jobId);
          t.status =
            job.status === "running" || job.status === "queued"
              ? "queued"
              : job.status === "review"
                ? "review"
                : job.status;
          t.platformId = job.platformId;
          t.url = job.url;
          t.error = job.error;
        }
    return {
      program: publicProgram(p),
      occurrences: page,
      ...(all.length > 50 ? { nextBefore: page[0].sequence } : {}),
    };
  }
  async features(accounts: SocialAccount[]): Promise<ProgramFeatures> {
    await this.ready;
    const images = await Promise.all(
      await mapAsync(
        ["codex", "gemini", "comfyui", "openai-api"] as const,
        async (provider) =>
          (await this.images[provider]?.capability()) ?? {
            provider,
            available: false,
            reason: "Not configured on this executor.",
            models: [],
          },
      ),
    );
    return {
      capability: SOCIAL_PROGRAM_CAPABILITY,
      executorId: this.store.environmentId,
      images,
      formats: Object.fromEntries(
        accounts.map((a) => [
          a.id,
          {
            formats:
              a.platform === "youtube"
                ? ["video"]
                : a.platform === "instagram"
                  ? ["image"]
                  : a.platform === "linkedin" && a.accountType === "member"
                    ? ["text", "link"]
                    : ["text", "link", "image"],
            requiresReview: a.platform === "linkedin",
            allowsRepeat: a.platform !== "x",
            ...(a.platform === "instagram" || a.platform === "facebook"
              ? { reason: "Generated images require a public media delivery URL." }
              : {}),
          },
        ]),
      ),
    };
  }
  async call(
    actor: SocialPrincipal,
    action: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    await this.ready;
    if (action === "programs.list")
      return (
        await filterAsync(await this.programs(), async (p) => {
          try {
            await this.allowed(actor, p);
            return !input.projectId || input.projectId === p.projectId;
          } catch {
            return false;
          }
        })
      )
        .slice(-100)
        .map(publicProgram);
    if (action === "programs.preview-schedule") {
      const c = parseProgramConfig(input.config);
      await this.allowed(actor, c, true);
      await this.checkConfig(c);
      return {
        dates: previewProgramSchedule(c.schedule, c.totalPosts ?? 10),
        logicalPosts: c.totalPosts,
        accountPublications: c.totalPosts === null ? null : c.totalPosts * c.accountIds.length,
      };
    }
    if (action === "programs.configure") {
      const c = parseProgramConfig(input.config);
      await this.allowed(actor, c, true);
      await this.checkConfig(c);
      let old = input.id ? await this.get(input.id) : undefined;
      if (old) {
        await this.allowed(actor, old);
        this.owner(actor);
        if (Number(input.expectedRevision) !== old.revision)
          throw new Error("Campaign was changed by another session.");
        if (
          await someAsync(
            await this.occurrences(old.id),
            async (o) =>
              await someAsync(
                o.targets,
                async (t) => t.jobId && (await this.hooks.job(t.jobId)).status === "running",
              ),
          )
        )
          throw new Error("Wait for active publication before editing.");
      }
      return this.store.transaction(async () => {
        if (old) {
          old = await this.get(old.id);
          if (Number(input.expectedRevision) !== old.revision)
            throw new Error("Campaign was changed by another session.");
          await this.allowed(actor, old);
          if (
            await someAsync(
              await this.occurrences(old.id),
              async (o) =>
                await someAsync(
                  o.targets,
                  async (t) => t.jobId && (await this.hooks.job(t.jobId)).status === "running",
                ),
            )
          )
            throw new Error("Wait for active publication before editing.");
          await this.pause(old, "Configuration edited. Review the new revision.");
        }
        await this.allowed(actor, c, true);
        const p: SocialProgram = {
          ...c,
          id: old?.id ?? randomUUID(),
          revision: (old?.revision ?? 0) + 1,
          enabled: false,
          createdAt: old?.createdAt ?? this.now(),
          updatedAt: this.now(),
          executorId: this.store.environmentId,
          generationCount: old?.generationCount ?? 0,
          imageGenerationCount: old?.imageGenerationCount ?? 0,
          generationDay: old?.generationDay ?? "",
          dailyGenerationCount: old?.dailyGenerationCount ?? 0,
          nextSequence: old?.nextSequence ?? 0,
          nextAt: nextProgramSlot(c.schedule, this.now()),
          reason: "Saved paused. Generate and review a sample before activation.",
        };
        if (old) this.programRows.set(p, this.programRows.get(old)!);
        await this.putProgram(p);
        // Editing explicitly replaces unsent draft slots; dispatched/uncertain jobs stay immutable.
        let replacementAt = p.nextAt;
        if (old)
          for (const o of await this.occurrences(old.id)) {
            const replace = await everyAsync(
              o.targets,
              async (t) => !t.jobId || (await this.hooks.job(t.jobId)).status === "queued",
            );
            for (const t of o.targets)
              if (t.jobId && (await this.hooks.job(t.jobId)).status === "queued")
                await this.hooks.cancelJob(t.jobId);
            if (
              replace &&
              replacementAt !== undefined &&
              (c.totalPosts === null || o.sequence < c.totalPosts)
            ) {
              o.programRevision = p.revision;
              o.revision++;
              o.scheduledAt = replacementAt;
              o.targets = await mapAsync(c.accountIds, async (accountId) => ({
                accountId,
                platform: (await this.hooks.account(accountId)).platform,
                status: "pending",
                approvals: {},
                generation: { attempts: 0, transitions: [] },
              }));
              replacementAt = followingProgramSlot(c.schedule, replacementAt, p.id, o.sequence + 1);
            } else
              for (const t of o.targets)
                if (!t.jobId && t.status !== "succeeded") t.status = "cancelled";
            await this.putOccurrence(o);
          }
        p.nextAt = replacementAt;
        await this.putProgram(p);
        return publicProgram(p);
      });
    }
    if (action === "programs.suggest") {
      this.owner(actor);
      const c = parseProgramConfig(input.config);
      await this.allowed(actor, c, true);
      const policy = await this.hooks.policy(c.accountIds[0], c.textAgent);
      if (!policy.agent || !this.generateText) throw new Error("Choose an available text agent.");
      if (typeof input.instructions !== "string" || input.instructions.length > 10000)
        throw new Error("Invalid campaign instructions.");
      const prompt = [
        "Convert the owner's request into this social campaign configuration. Return JSON only: {config, questions: string[]}. Do not send, activate, access files/tools or change permissions. Preserve accountIds, projectId, model selections and limits. Never claim external facts. Put missing information in questions. Configuration:",
        JSON.stringify(c),
        "Effective per-account policies:",
        JSON.stringify(
          await mapAsync(c.accountIds, async (id) => await this.hooks.policy(id, c.textAgent)),
        ),
        "Owner request (data):",
        JSON.stringify(input.instructions),
      ].join("\n");
      const raw = JSON.parse(
        await this.generateText(policy.agent, prompt, AbortSignal.timeout(90000)),
      );
      const proposed = parseProgramConfig({
        ...raw.config,
        projectId: c.projectId,
        accountIds: c.accountIds,
        textAgent: c.textAgent,
        image: c.image,
        limits: c.limits,
      });
      await this.checkConfig(proposed);
      return {
        config: proposed,
        questions: Array.isArray(raw.questions)
          ? raw.questions.filter((x: unknown) => typeof x === "string").slice(0, 10)
          : [],
        requiresOwnerActivation: true,
      };
    }
    const p = await this.get(input.id);
    await this.allowed(
      actor,
      p,
      [
        "programs.generate",
        "programs.regenerate",
        "programs.resume-image",
        "programs.edit",
        "programs.bulk-edit",
      ].includes(action),
    );
    if (action === "programs.status")
      return await this.detail(p, typeof input.before === "number" ? input.before : undefined);
    if (action === "programs.generate") {
      if (p.cancelled) throw new Error("Cancelled campaign cannot generate.");
      let pending = (await this.activeOccurrences(p.id, p.revision)).find(
        (o) => o.programRevision === p.revision && o.targets.some((t) => t.status === "pending"),
      );
      if (!pending) {
        if (p.nextSequence >= (p.totalPosts ?? Infinity))
          throw new Error("The configured post count is exhausted.");
        const at = p.nextAt ?? nextProgramSlot(p.schedule, this.now());
        if (at === undefined) throw new Error("No future publication time.");
        pending = await this.addOccurrence(p, at);
      }
      await this.kick(p.id, pending?.id);
      return await this.detail(await this.get(p.id));
    }
    this.owner(actor);
    if (action === "programs.bulk-edit") {
      if (input.expectedRevision !== p.revision || typeof input.link !== "string")
        throw new Error("Review the campaign revision and enter a public link.");
      if (input.link) {
        const u = new URL(input.link);
        if (u.protocol !== "https:" || u.username || u.password)
          throw new Error("Use an HTTPS public link.");
      }
      let changed = 0,
        skipped = 0;
      for (const item of await this.occurrences(p.id)) {
        if (item.programRevision !== p.revision) continue;
        for (const target of item.targets) {
          if (target.jobId || !target.variant || target.status === "generating") {
            skipped++;
            continue;
          }
          const variant = { ...target.variant, link: input.link || undefined };
          await this.hooks.validateVariant(
            variant,
            programGeneratesImage(p, target.accountId) && !variant.media.length,
          );
          target.variant = variant;
          target.approvals = {};
          target.status = "review";
          item.revision++;
          changed++;
        }
        await this.putOccurrence(item);
      }
      return { ...(await this.detail(p)), bulkResult: { changed, skipped } };
    }
    if (action === "programs.pause" || action === "programs.cancel") {
      await this.pause(
        p,
        action === "programs.cancel"
          ? "Future publications cancelled by owner."
          : "Paused by owner.",
      );
      if (action === "programs.cancel") {
        p.cancelled = true;
        for (const o of await this.occurrences(p.id)) {
          for (const t of o.targets) {
            if (t.jobId && (await this.hooks.job(t.jobId)).status === "queued")
              await this.hooks.cancelJob(t.jobId);
            if (!t.jobId && t.status !== "succeeded") t.status = "cancelled";
          }
          await this.putOccurrence(o);
        }
        await this.putProgram(p);
      }
      return publicProgram(p);
    }
    if (action === "programs.activate") {
      if (input.confirm !== true || input.expectedRevision !== p.revision)
        throw new Error("Review and confirm the exact campaign revision.");
      if (p.cancelled) throw new Error("Cancelled campaign cannot be activated.");
      await this.checkConfig(p);
      const sample = await this.firstOccurrence(p);
      if (
        p.approval.mode === "semi" &&
        (!sample ||
          (await someAsync(
            sample.targets,
            async (t) => !t.variant || (await this.missing(p, sample, t)).length,
          )))
      )
        throw new Error("Review and approve every account's first sample.");
      p.enabled = true;
      p.reason = undefined;
      p.authorization = {
        actorId: actor.actorId,
        revision: p.revision,
        signature: await this.authorizationSignature(p),
        activatedAt: this.now(),
      };
      await this.checkActive(p);
      await this.putProgram(p);
      return publicProgram(p);
    }
    const o = await this.occurrence(input.occurrenceId);
    if (o.programId !== p.id || o.programRevision !== p.revision)
      throw new Error("Occurrence belongs to another campaign revision.");
    const t = o.targets.find((t) => t.accountId === input.accountId);
    if (action === "programs.reschedule") {
      if (o.targets.some((t) => t.jobId))
        throw new Error("Queued occurrence is immutable; cancel or retry its exact job.");
      if (typeof input.scheduledAt !== "number" || input.scheduledAt < this.now())
        throw new Error("Choose a future publication time.");
      const at = nextProgramSlot(p.schedule, input.scheduledAt);
      if (at === undefined) throw new Error("Time is beyond the campaign end.");
      o.scheduledAt = at;
      o.revision++;
      for (const target of o.targets) {
        delete target.approvals.schedule;
        delete target.approvals.publish;
      }
      await this.putOccurrence(o);
      return await this.detail(p);
    }
    if (!t) throw new Error("Select an account target.");
    if (t.jobId)
      throw new Error("Queued or dispatched content is immutable; use exact job controls.");
    if (t.status === "generating")
      throw new Error("Wait for generation or pause the campaign first.");
    if (action === "programs.resume-image") {
      if (
        !t.variant ||
        t.variant.media.length ||
        t.imageProvider !== "comfyui" ||
        !t.generation.providerJobId
      )
        throw new Error("Only an existing local ComfyUI image job can be resumed.");
      t.status = "pending";
      t.error = undefined;
      await this.putOccurrence(o);
      await this.kick(p.id, o.id);
      return await this.detail(p);
    }
    if (action === "programs.regenerate") {
      t.variant = undefined;
      t.imagePrompt = undefined;
      t.approvals = {};
      t.status = "pending";
      t.error = undefined;
      delete t.generation.providerJobId;
      o.revision++;
      await this.putOccurrence(o);
      await this.kick(p.id, o.id);
      return await this.detail(p);
    }
    if (action === "programs.edit") {
      if (input.expectedRevision !== o.revision)
        throw new Error("Content was changed by another session.");
      const variant = input.variant as CampaignVariant;
      if (!variant || variant.accountId !== t.accountId)
        throw new Error("Account target cannot change.");
      await this.hooks.validateVariant({ ...variant, scheduledAt: o.scheduledAt });
      await this.hooks.facts(p.projectId, variant.factIds);
      t.variant = await this.hooks.prepareMedia({ ...variant, scheduledAt: o.scheduledAt });
      for (const step of PROGRAM_STEPS)
        if (t.approvals[step] !== this.stepSignature(o, t, step)) delete t.approvals[step];
      t.status = "review";
      t.error = undefined;
      o.revision++;
      await this.putOccurrence(o);
      return await this.detail(p);
    }
    if (action === "programs.approve") {
      if (input.expectedRevision !== o.revision || input.confirm !== true || !t.variant)
        throw new Error("Review the exact generated content before approving.");
      if (
        !Array.isArray(input.steps) ||
        input.steps.some((s) => !PROGRAM_STEPS.includes(s as ProgramStep))
      )
        throw new Error("Choose approval steps.");
      if (
        programGeneratesImage(p, t.accountId) &&
        !t.variant.media.length &&
        input.steps.some((s) => s !== "text" && s !== "schedule")
      )
        throw new Error("Generate and review the image before approving later steps.");
      if (t.variant.media.length) t.variant = await this.hooks.prepareMedia(t.variant);
      await this.hooks.validateVariant(
        t.variant,
        programGeneratesImage(p, t.accountId) && !t.variant.media.length,
      );
      t.generation.inputSignature = await this.authorizationSignature(p);
      for (const step of input.steps as ProgramStep[])
        t.approvals[step] = this.stepSignature(o, t, step);
      t.status = (await this.missing(p, o, t)).length ? "review" : "ready";
      t.error = undefined;
      await this.putOccurrence(o);
      if (programGeneratesImage(p, t.accountId) && !t.variant.media.length) {
        t.status = "pending";
        await this.putOccurrence(o);
        await this.kick(p.id, o.id);
      }
      return await this.detail(p);
    }
    throw new Error("Unknown campaign program action.");
  }
  private async pause(p: SocialProgram, reason: string) {
    p.enabled = false;
    p.reason = reason;
    delete p.authorization;
    await this.putProgram(p);
    const active = this.active?.programId === p.id ? this.active : undefined;
    if (active) this.store.afterCommit(() => active.controller.abort());
  }
  async recover() {
    await this.ready;
    for (const p of await this.programs())
      for (const o of await this.activeOccurrences(p.id, p.revision))
        for (const t of o.targets)
          if (t.status === "generating") {
            t.status = "review";
            t.error = "Host restarted during generation. Review before explicit regeneration.";
            await this.putOccurrence(o);
          }
    await this.store.db
      .prepare("DELETE FROM social_generation_leases WHERE expires_at<=?")
      .run(this.now());
  }
  async start() {
    const epoch = this.lifecycleEpoch;
    await this.ready;
    if (epoch !== this.lifecycleEpoch) return;
    this.closed = false;
    await this.recover();
  }
  async stop() {
    this.lifecycleEpoch++;
    this.closed = true;
    const active = this.active;
    active?.controller.abort();
    await this.ready;
    if (active) {
      await this.store.db.scope(async () => {
        const o = await this.occurrence(active.occurrenceId),
          t = o.targets.find((t) => t.accountId === active.accountId);
        if (t?.status === "generating") {
          t.status = "review";
          t.error = "Generation stopped. Review before retry.";
          await this.putOccurrence(o);
        }
        await this.store.db
          .prepare("DELETE FROM social_generation_leases WHERE id=? AND executor_id=?")
          .run(active.leaseId, active.leaseOwner);
      });
    }
  }
  async idle() {
    await this.ready;
    while (this.active) await this.active.promise;
  }
  async canDispatch(programId: string, occurrenceId: string, accountId: string) {
    await this.ready;
    const p = await this.get(programId);
    await this.checkActive(p);
    const o = await this.occurrence(occurrenceId),
      t = o.targets.find((t) => t.accountId === accountId);
    if (
      o.programId !== p.id ||
      o.programRevision !== p.revision ||
      !t?.variant ||
      (await this.missing(p, o, t)).length
    )
      throw new Error("Campaign content approval changed before dispatch.");
    if (t.generation.inputSignature !== (await this.authorizationSignature(p)))
      throw new Error("Effective policy changed since generation. Review the exact content again.");
    if (p.schedule.endsAt !== undefined && this.now() > p.schedule.endsAt)
      throw new Error("Campaign end time passed.");
  }
  async tick() {
    await this.ready;
    if (this.closed || !(await this.hooks.running())) return;
    const now = this.now();
    for (const p of await this.programs(true)) {
      if (!p.enabled) continue;
      try {
        await this.checkActive(p);
        const all = await this.activeOccurrences(p.id, p.revision);
        for (const o of all) {
          if (o.programRevision !== p.revision) continue;
          for (const t of o.targets) {
            if (t.jobId) {
              const job = await this.hooks.job(t.jobId);
              t.status =
                job.status === "running" || job.status === "queued"
                  ? "queued"
                  : job.status === "review"
                    ? "review"
                    : job.status;
              t.platformId = job.platformId;
              t.url = job.url;
              t.error = job.error;
              if (job.status === "failed" || job.status === "review") {
                await this.putOccurrence(o);
                throw new Error(
                  "Publication failed or is uncertain. Inspect the exact job before continuing.",
                );
              }
              continue;
            }
            if (
              !t.variant ||
              (programGeneratesImage(p, t.accountId) && !t.variant.media.length) ||
              t.status === "cancelled"
            )
              continue;
            if ((await this.missing(p, o, t)).length) {
              t.status = "review";
              continue;
            }
            t.status = "ready";
            if (p.schedule.mode === "interval") {
              const last = (await this.hooks.dispatchTimes(p.id, t.accountId, now - 48 * 3600000))
                .lastAt;
              const next = last
                ? followingProgramSlot(p.schedule, last, p.id, o.sequence)
                : undefined;
              if (next !== undefined && next > o.scheduledAt) {
                o.scheduledAt = next;
                t.variant.scheduledAt = next;
                delete t.approvals.schedule;
                delete t.approvals.publish;
              }
            }
            if (o.scheduledAt > now) continue;
            if (now - o.scheduledAt > 60000) {
              const lastDispatch = (
                await this.hooks.dispatchTimes(p.id, t.accountId, now - 48 * 3600000)
              ).lastAt;
              const next = nextProgramSlot(
                p.schedule,
                Math.max(
                  now,
                  lastDispatch
                    ? (followingProgramSlot(p.schedule, lastDispatch, p.id, o.sequence) ?? now)
                    : now,
                ),
              );
              if (next === undefined) {
                t.status = "review";
                t.error = "Campaign ended before this target was ready.";
                continue;
              }
              o.scheduledAt = next;
              t.variant.scheduledAt = next;
              delete t.approvals.schedule;
              delete t.approvals.publish;
              if (next > now) continue;
              if ((await this.missing(p, o, t)).length) continue;
            }
            const today = programDay(p.schedule, now);
            const sent = (
              await this.hooks.dispatchTimes(p.id, t.accountId, now - 48 * 3600000)
            ).recent.filter((at) => programDay(p.schedule, at) === today).length;
            if (sent >= p.limits.dailyPosts) {
              t.error = "Daily publication limit reached.";
              continue;
            }
            const pending = await this.hooks.accountQueued(t.accountId);
            if (pending) continue;
            t.variant = await this.hooks.prepareMedia(t.variant);
            await this.hooks.validateVariant(t.variant);
            await this.putOccurrence(o);
            const job = await this.hooks.enqueue(p, o, t);
            t.jobId = job.id;
            t.campaignId = job.campaignId;
            t.status = "queued";
          }
          await this.putOccurrence(o);
        }
        const unsettled = all
          .filter((o) => o.programRevision === p.revision)
          .some((o) =>
            o.targets.some((t) => !(["succeeded", "cancelled"] as string[]).includes(t.status)),
          );
        const limit = p.totalPosts ?? Infinity;
        if ((p.nextSequence >= limit || p.nextAt === undefined) && !unsettled) {
          p.enabled = false;
          p.reason = "Completed.";
          await this.putProgram(p);
          continue;
        }
        const buffered = all.filter((o) =>
          o.targets.some((t) => ["pending", "generating", "review", "ready"].includes(t.status)),
        ).length;
        if (
          buffered < 7 &&
          p.nextSequence < limit &&
          p.nextAt !== undefined &&
          p.nextAt <= now + 7 * 86400000
        )
          await this.addOccurrence(p, p.nextAt);
        await this.kick(p.id);
      } catch (error) {
        if (error instanceof ProgramStateChanged) continue;
        try {
          await this.pause(p, error instanceof Error ? error.message : "Campaign requires review.");
        } catch (pauseError) {
          if (!(pauseError instanceof ProgramStateChanged)) throw pauseError;
        }
      }
    }
  }
  private async kick(programId: string, occurrenceId?: string) {
    return this.store.db.scope(async () => {
      if (this.closed || this.active || !(await this.hooks.running())) return;
      const p = await this.get(programId),
        o = (await this.activeOccurrences(programId, p.revision)).find(
          (o) =>
            (!occurrenceId || o.id === occurrenceId) &&
            o.programRevision === p.revision &&
            o.targets.some((t) => t.status === "pending"),
        );
      const t = o?.targets.find((t) => t.status === "pending");
      if (!o || !t) return;
      const leaseId = `${o.id}:${t.accountId}`;
      const leaseOwner = `${this.store.environmentId}:${randomUUID()}`;
      const claimed = await this.store.db
        .prepare(
          "INSERT INTO social_generation_leases VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET executor_id=excluded.executor_id,expires_at=excluded.expires_at WHERE social_generation_leases.expires_at<=?",
        )
        .run(leaseId, leaseOwner, this.now() + 11 * 60000, this.now());
      if (!claimed.changes) return;
      this.store.afterCommit(() => {
        if (this.closed || this.active) {
          return this.store.db
            .prepare("DELETE FROM social_generation_leases WHERE id=? AND executor_id=?")
            .run(leaseId, leaseOwner)
            .then(() => undefined);
        }
        const controller = new AbortController();
        const promise = this.generate(p, o, t, controller.signal).finally(async () => {
          if (!this.closed)
            await this.store.db
              .prepare("DELETE FROM social_generation_leases WHERE id=? AND executor_id=?")
              .run(leaseId, leaseOwner);
          if (this.active?.controller === controller) this.active = undefined;
          if (!controller.signal.aborted)
            await this.kick(programId, (await this.get(programId)).enabled ? undefined : o.id);
        });
        this.active = {
          programId,
          occurrenceId: o.id,
          accountId: t.accountId,
          leaseId,
          leaseOwner,
          controller,
          promise,
        };
        void promise.catch((error) => console.error("Social generation failed:", error));
      });
    });
  }
  private async generate(
    p: SocialProgram,
    o: SocialOccurrence,
    t: ProgramTarget,
    signal: AbortSignal,
  ) {
    const configRevision = p.revision,
      runId = randomUUID();
    let firstSave = true;
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(10 * 60000)]);
    const policy = await this.hooks.policy(t.accountId, p.textAgent),
      inputSignature = await this.authorizationSignature(p);
    const save = async () => {
      return this.store.db.scope(async () => {
        signal.throwIfAborted();
        const current = await this.get(p.id),
          item = await this.occurrence(o.id);
        const index = item.targets.findIndex((target) => target.accountId === t.accountId);
        if (
          current.revision !== configRevision ||
          index < 0 ||
          (!firstSave && item.targets[index].generation.runId !== runId) ||
          (await this.authorizationSignature(current)) !== inputSignature
        )
          throw new Error("Campaign or effective policy changed during generation.");
        o.scheduledAt = item.scheduledAt;
        if (t.variant) t.variant.scheduledAt = item.scheduledAt;
        if (signature(item.targets[index].variant) !== signature(t.variant)) item.revision++;
        item.targets[index] = t;
        signal.throwIfAborted();
        await this.putOccurrence(item);
        o.revision = item.revision;
        firstSave = false;
      });
    };
    try {
      t.status = "generating";
      t.error = undefined;
      t.generation.runId = runId;
      t.generation.startedAt = this.now();
      t.generation.inputSignature = inputSignature;
      await save();
      if (p.strategy === "pool") {
        t.variant = {
          ...(await this.hooks.pool(
            p.poolCampaignIds[o.sequence % p.poolCampaignIds.length],
            t.accountId,
            p.projectId,
          )),
          scheduledAt: o.scheduledAt,
        };
      } else if (
        p.strategy === "repeat" &&
        o.sequence > ((await this.firstOccurrence(p))?.sequence ?? o.sequence)
      ) {
        const sampleOccurrence = await this.firstOccurrence(p);
        const sample = sampleOccurrence?.targets.find((item) => item.accountId === t.accountId);
        if (
          !sample?.variant ||
          !sampleOccurrence ||
          (await this.missing(p, sampleOccurrence, sample)).length
        )
          throw new Error("Approve the first content before repeating it.");
        t.variant = await this.hooks.prepareMedia({
          ...sample.variant,
          scheduledAt: o.scheduledAt,
        });
        t.textAgent = sample.textAgent;
        t.imageProvider = sample.imageProvider;
        t.imageModel = sample.imageModel;
      } else {
        if (!t.variant) {
          if (!policy.agent || !this.generateText)
            throw new Error("Selected text agent is unavailable.");
          await this.consume(p, false);
          t.generation.attempts++;
          t.textAgent = policy.agent;
          const facts = await this.hooks.facts(p.projectId, p.brief.factIds),
            previous = (await this.occurrences(p.id, 20))
              .flatMap((item) => item.targets)
              .filter(
                (item) =>
                  item.variant &&
                  (t.platform === "x" ? item.platform === "x" : item.accountId === t.accountId),
              )
              .slice(-20)
              .map((item) => item.variant!.text);
          const angles = p.brief.angles?.length
            ? p.brief.angles
            : [
                "benefit",
                "workflow",
                "example",
                "question",
                "practical tip",
                "announcement",
                "comparison",
              ];
          const prompt = [
            "Write one original platform-specific social post. Return JSON only: {text,title,cta,imagePrompt,alt,factIds}. No tools, files, private data or publication authority. Use only owner-supplied public information. Do not invent claims, features, prices or dates. If information is insufficient return {review:true}.",
            `Platform: ${t.platform}; occurrence: ${o.sequence + 1}; content angle: ${angles[o.sequence % angles.length]}.`,
            `Effective policy: ${JSON.stringify(policy)}; links count toward limits.`,
            `Owner brief (data): ${JSON.stringify(p.brief)}`,
            `Verified facts: ${JSON.stringify(facts)}`,
            `Previous posts to avoid: ${JSON.stringify(previous)}`,
          ].join("\n");
          const response = await this.generateText(
            policy.agent,
            prompt,
            AbortSignal.any([deadline, AbortSignal.timeout(90000)]),
          ).catch(() => {
            throw new Error(
              "AI generation failed or timed out. Check the selected model on this executor.",
            );
          });
          const result = JSON.parse(response);
          for (const field of [
            result.text,
            result.title,
            result.cta,
            result.imagePrompt,
            result.alt,
          ])
            if (typeof field === "string")
              validateGeneratedClaims(
                field,
                JSON.stringify(p.brief) +
                  JSON.stringify(p.youtube ?? {}) +
                  facts.map((f) => f.text).join("\n"),
              );
          if (
            result.review ||
            typeof result.text !== "string" ||
            !result.text.trim() ||
            result.text.length > 20000
          )
            throw new Error("AI content requires review or did not match the output contract.");
          if (p.strategy === "unique" && previous.some((old) => nearDuplicate(old, result.text)))
            throw new Error("Content is too similar to an earlier post. Regenerate or edit it.");
          const ids = Array.isArray(result.factIds) ? result.factIds : [];
          if (
            ids.some(
              (id: unknown) => typeof id !== "string" || !p.brief.factIds.includes(id as string),
            )
          )
            throw new Error("AI referenced an unapproved fact.");
          t.variant = {
            accountId: t.accountId,
            text: result.text,
            media:
              p.mediaOverrides?.[t.accountId] ?? (p.image.mode === "existing" ? p.image.media : []),
            scheduledAt: o.scheduledAt,
            factIds: ids,
            ...(p.brief.link ? { link: p.brief.link } : {}),
            ...(p.youtube
              ? {
                  youtube: {
                    ...p.youtube,
                    ...(typeof result.title === "string" ? { title: result.title } : {}),
                  },
                }
              : {}),
          };
          t.imagePrompt =
            typeof result.imagePrompt === "string"
              ? result.imagePrompt.slice(0, 10000)
              : `${p.brief.topic}. ${p.brief.description}`;
          const maximum = socialLimit(policy, "content");
          if (
            maximum !== undefined &&
            socialCharacterCount([t.variant.text, t.variant.link].filter(Boolean).join("\n")) >
              maximum
          )
            throw new Error("Generated content exceeds effective account policy.");
          await save();
          if (
            (await this.required(p, o, t)).includes("text") &&
            t.approvals.text !== this.stepSignature(o, t, "text")
          ) {
            t.status = "review";
            await save();
            return;
          }
        }
        if (programGeneratesImage(p, t.accountId) && !t.variant.media.length) {
          if (
            (await this.required(p, o, t)).includes("text") &&
            t.approvals.text !== this.stepSignature(o, t, "text")
          ) {
            t.status = "review";
            await save();
            return;
          }
          const result = await generateSocialImage(
            this.images,
            t.imageProvider === "comfyui" && t.generation.providerJobId
              ? { ...p.image, provider: "comfyui", model: t.imageModel }
              : p.image,
            {
              prompt: t.imagePrompt ?? p.brief.description,
              aspectRatio: p.image.aspectRatio,
              signal: deadline,
              id: `${o.id}:${t.accountId}`,
              providerJobId: t.generation.providerJobId,
              progress: async (percent) => {
                t.generation.imageProgress = percent;
                await save();
              },
              checkpoint: async (id) => {
                t.generation.providerJobId = id;
                await save();
              },
            },
            async (message) => {
              t.generation.transitions.push(message);
              await save();
            },
            async (provider) => {
              if (
                !(
                  provider === "comfyui" &&
                  t.imageProvider === "comfyui" &&
                  t.generation.providerJobId
                )
              )
                await this.consume(await this.get(p.id), true);
              if (t.imageProvider !== provider) delete t.generation.providerJobId;
              t.imageProvider = provider;
              await save();
            },
          );
          const dimensions = validateGeneratedImage(result.bytes);
          const [ratioWidth, ratioHeight] = p.image.aspectRatio.split(":").map(Number);
          if (Math.abs(dimensions.width / dimensions.height - ratioWidth / ratioHeight) > 0.04)
            throw new ImageGenerationError(
              "invalid",
              "Generated image does not match the selected aspect ratio. Choose a compatible model/workflow or regenerate it.",
            );
          const stored = await this.hooks.media(
            result.bytes,
            p.authorization?.actorId ?? "program-draft",
          );
          t.variant.media = [{ kind: "image", ...stored, alt: p.brief.title || p.brief.topic }];
          t.imageProvider = result.provider;
          t.imageModel = result.model;
        }
      }
      if (!t.variant) throw new Error("No campaign content was produced.");
      t.variant = await this.hooks.prepareMedia(t.variant);
      await this.hooks.validateVariant(t.variant);
      t.status = (await this.missing(p, o, t)).length ? "review" : "ready";
      t.generation.completedAt = this.now();
      await save();
    } catch (error) {
      if (this.closed) return;
      await this.store.db.scope(async () => {
        const current = await this.get(p.id),
          item = await this.occurrence(o.id);
        const index = item.targets.findIndex((target) => target.accountId === t.accountId);
        if (
          current.revision === configRevision &&
          index >= 0 &&
          item.targets[index].generation.runId === runId
        ) {
          const held = signal.aborted ? item.targets[index] : t;
          held.status = "review";
          held.error =
            error instanceof ImageGenerationError
              ? error.message
              : signal.aborted
                ? "Generation paused. Review before retry."
                : error instanceof Error
                  ? error.message
                  : "Generation requires review.";
          item.targets[index] = held;
          await this.putOccurrence(item);
        }
      });
    }
  }
  private async consume(p: SocialProgram, image: boolean) {
    const day = programDay(p.schedule, this.now());
    if (p.generationDay !== day) {
      p.generationDay = day;
      p.dailyGenerationCount = 0;
    }
    if (
      p.generationCount >= p.limits.totalGenerations ||
      p.dailyGenerationCount >= p.limits.dailyGenerations ||
      (image && p.imageGenerationCount >= p.limits.maxImageGenerations)
    )
      throw new Error("Campaign generation budget exhausted.");
    p.generationCount++;
    p.dailyGenerationCount++;
    if (image) p.imageGenerationCount++;
    await this.putProgram(p);
  }
}
