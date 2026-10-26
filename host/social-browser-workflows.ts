import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { SocialAccount } from "../src/features/social/model/social";
import {
  socialBrowserUrl,
  type SocialBrowserIntent,
  type SocialBrowserState,
  type SocialBrowserWorkflow,
  type SocialRegistrationReview,
} from "../src/features/social/model/socialBrowser";
import type { BrowserLauncher, BrowserPage, PlainBrowserLauncher } from "./social-browser";
import type { SocialPrincipal, SocialService } from "./social";
import {
  advanceSocialRegistration,
  inspectSocialRegistration,
  parseRegistrationProfile,
  reviewLinkedInPageRegistration,
  readExistingLinkedInPageRegistration,
  submitLinkedInPageRegistration,
  type LinkedInPageRegistrationSnapshot,
  type RegistrationProfile,
  type RegistrationProgress,
} from "./social-browser-registration";

type Active = {
  record: SocialBrowserWorkflow;
  cancelled: boolean;
  closed: boolean;
  close?: () => Promise<void>;
  page?: BrowserPage;
  profile?: RegistrationProfile;
  tail?: Promise<void>;
  busy?: boolean;
  review?: {
    public: SocialRegistrationReview;
    snapshot: LinkedInPageRegistrationSnapshot;
    digest: string;
  };
};
type Reconciliation = { cancelled: boolean; active?: Active; close?: () => Promise<void> };
const RUNNING = new Set(["queued", "awaiting_owner"]);
const TIMEOUT = 20 * 60_000;
class WorkflowInterruption extends Error {
  constructor(readonly status: "interrupted" | "expired" | "window_closed" = "interrupted") {
    super("The browser workflow is no longer active. Review its status before resuming.");
  }
}
const copy = (record: SocialBrowserWorkflow): SocialBrowserWorkflow =>
  JSON.parse(JSON.stringify(record));
const expectedLinkedInResourceDigest = (value: {
  administrator: { id: string };
  fields: { displayName: string; username: string };
}) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        administratorId: value.administrator.id,
        displayName: value.fields.displayName.trim(),
        username: value.fields.username.trim().toLowerCase(),
      }),
    )
    .digest("hex");

/** Durable owner-assisted browser work, isolated from automatic social send permissions. */
export class SocialBrowserWorkflows {
  private active = new Map<string, Active>();
  private reconciliations = new Map<string, Reconciliation>();
  private stopped = false;
  constructor(
    private readonly plain: PlainBrowserLauncher | undefined,
    private readonly profile: (account: SocialAccount) => string,
    private readonly exclusive: <T>(accountId: string, action: () => Promise<T>) => Promise<T>,
    private readonly now = Date.now,
    private readonly wait: (ms: number) => Promise<unknown> = sleep,
    private readonly automated?: BrowserLauncher,
    private readonly isLoginWaiting: (accountId: string) => boolean = () => false,
  ) {}

  private serialize<T>(active: Active, action: () => Promise<T>): Promise<T> {
    const result = (active.tail ?? Promise.resolve()).then(async () => {
      active.busy = true;
      try {
        return await action();
      } finally {
        active.busy = false;
      }
    });
    active.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private async beforeAction(
    service: SocialService,
    principal: SocialPrincipal,
    active: Active,
    automated = true,
  ) {
    const live = () => {
      if (
        this.stopped ||
        active.cancelled ||
        this.active.get(active.record.accountId) !== active ||
        !RUNNING.has(active.record.status)
      )
        throw new WorkflowInterruption();
      if (active.closed) throw new WorkflowInterruption("window_closed");
      if (this.now() >= active.record.expiresAt) throw new WorkflowInterruption("expired");
    };
    live();
    let account: SocialAccount;
    try {
      account = await this.account(service, principal, active.record.accountId);
      if (automated)
        account = await service.accountForBrowserManagement(principal, account.id, true);
    } catch {
      throw new WorkflowInterruption();
    }
    if (
      account.platform !== active.record.platform ||
      account.executorId !== service.store.environmentId ||
      (active.record.intent === "signup" && account.connected)
    )
      throw new WorkflowInterruption();
    if (automated && account.paused) throw new WorkflowInterruption();
    await service.store.db.checkAuthorization();
    live();
  }
  private progress(active: Active, state: RegistrationProgress) {
    active.record.registration = {
      status: state.status,
      step: state.step,
      blockers: [...state.blockers],
      requiredFields: [...state.requiredFields],
      filledFields: [
        ...new Set([...(active.record.registration?.filledFields ?? []), ...state.filledFields]),
      ],
      canAdvance: state.canAdvance,
      message: state.message,
    };
  }
  private async prepareRegistration(
    service: SocialService,
    principal: SocialPrincipal,
    active: Active,
  ) {
    if (!active.page || !active.profile) throw new Error("The registration window is not ready.");
    for (let step = 0; step < 8; step++) {
      await this.beforeAction(service, principal, active);
      const previous = JSON.stringify(active.record.registration);
      const state = await advanceSocialRegistration(
        active.page,
        active.record.platform,
        active.profile,
        {
          beforeAction: () => this.beforeAction(service, principal, active),
        },
      );
      await this.beforeAction(service, principal, active);
      this.progress(active, state);
      active.record.status = "awaiting_owner";
      await this.save(service, active.record);
      if (
        !state.canAdvance ||
        state.blockers.length ||
        state.status !== "ready" ||
        JSON.stringify(active.record.registration) === previous
      )
        break;
      await this.wait(150);
    }
  }
  private async failed(service: SocialService, active: Active, error: unknown) {
    if (active.cancelled || this.stopped) return;
    active.record.status = error instanceof WorkflowInterruption ? error.status : "failed";
    if (!(error instanceof WorkflowInterruption))
      active.record.error =
        "The browser workflow could not finish. Check the executor host and try again.";
    active.cancelled = true;
    await this.save(service, active.record).catch(() => undefined);
    await active.close?.().catch(() => undefined);
  }

  private async account(
    service: SocialService,
    principal: SocialPrincipal,
    id: string,
  ): Promise<SocialAccount> {
    if (principal.kind !== "owner") throw new Error("Browser workflows require the owner device.");
    const account = await service.accountForOAuth(principal, id);
    if (account.executorId !== service.store.environmentId)
      throw new Error("Open the browser workflow on the account's executor host.");
    return account;
  }
  private async records(
    service: SocialService,
    accountId: string,
  ): Promise<SocialBrowserWorkflow[]> {
    return (
      await service.store.db
        .prepare(
          "SELECT value FROM social_records WHERE kind='browser-workflow' AND json_extract(value,'$.accountId')=? AND (json_extract(value,'$.registrationSubmission') IS NOT NULL OR id IN (SELECT id FROM social_records WHERE kind='browser-workflow' AND json_extract(value,'$.accountId')=? ORDER BY json_extract(value,'$.createdAt') DESC, rowid DESC LIMIT 20)) ORDER BY json_extract(value,'$.createdAt') DESC, rowid DESC",
        )
        .all(accountId, accountId)
    ).map((row) => JSON.parse(String(row.value)) as SocialBrowserWorkflow);
  }
  private async save(service: SocialService, record: SocialBrowserWorkflow, stopping = false) {
    if (this.stopped && !stopping) return;
    record.updatedAt = Math.max(this.now(), record.updatedAt + 1);
    await service.store.db
      .prepare(
        "INSERT INTO social_records(kind,id,value) VALUES('browser-workflow',?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value",
      )
      .run(record.id, JSON.stringify(record));
    // Retain bounded workflow metadata only: no cookies, entered fields, page text or target URLs.
    await service.store.db
      .prepare(
        "DELETE FROM social_records WHERE kind='browser-workflow' AND json_extract(value,'$.registrationSubmission') IS NULL AND json_extract(value,'$.accountId')=? AND id NOT IN (SELECT id FROM social_records WHERE kind='browser-workflow' AND json_extract(value,'$.accountId')=? ORDER BY json_extract(value,'$.createdAt') DESC, rowid DESC LIMIT 20)",
      )
      .run(record.accountId, record.accountId);
  }
  async status(
    service: SocialService,
    principal: SocialPrincipal,
    accountId: string,
  ): Promise<SocialBrowserState> {
    await this.account(service, principal, accountId);
    const workflows = await this.records(service, accountId);
    const active = this.active.get(accountId);
    if (
      active?.page &&
      active.profile &&
      !active.busy &&
      !active.record.registrationSubmission &&
      active.record.status === "awaiting_owner"
    ) {
      await this.serialize(active, async () => {
        try {
          await this.beforeAction(service, principal, active);
          const previous = JSON.stringify(active.record.registration);
          const state = await inspectSocialRegistration(
            active.page!,
            active.record.platform,
            active.profile,
          );
          await this.beforeAction(service, principal, active);
          this.progress(active, state);
          if (JSON.stringify(active.record.registration) !== previous)
            await this.save(service, active.record);
        } catch (error) {
          await this.failed(service, active, error);
        }
        const index = workflows.findIndex((record) => record.id === active.record.id);
        if (index >= 0) workflows[index] = copy(active.record);
      });
    }
    for (const record of workflows) {
      if (RUNNING.has(record.status) && this.active.get(accountId)?.record.id !== record.id) {
        record.status = "interrupted";
        await this.save(service, record);
      }
    }
    return {
      available: !!this.plain || !!this.automated,
      reason:
        this.plain || this.automated
          ? "Owner-assisted browser workflows are available."
          : "Install Chrome or Edge on the executor host.",
      workflows,
    };
  }
  async begin(
    service: SocialService,
    principal: SocialPrincipal,
    input: {
      accountId: string;
      intent: SocialBrowserIntent;
      targetUrl?: unknown;
      acknowledgeRisk?: unknown;
      registration?: unknown;
    },
  ): Promise<SocialBrowserWorkflow> {
    const account = await this.account(service, principal, input.accountId);
    if (this.stopped) throw new Error("The browser workflow host is stopping.");
    if (this.reconciliations.has(account.id))
      throw new Error(
        "The existing registration result is being checked. Wait for it before opening another workflow.",
      );
    if (input.acknowledgeRisk !== true)
      throw new Error("Acknowledge the browser workflow before opening it.");
    const url = socialBrowserUrl(account.platform, input.intent, input.targetUrl);
    if (input.registration !== undefined && input.intent !== "signup")
      throw new Error("Registration fields require the signup workflow.");
    const profile =
      input.registration !== undefined ? parseRegistrationProfile(input.registration) : undefined;
    if (input.intent === "signup" && account.connected)
      throw new Error(
        "This account is already connected. Use login or create a separate local account.",
      );
    if (input.intent === "signup") {
      const attempted = await service.store.db
        .prepare(
          "SELECT id FROM social_records WHERE kind='browser-workflow' AND json_extract(value,'$.accountId')=? AND json_extract(value,'$.registrationSubmission') IS NOT NULL LIMIT 1",
        )
        .get(account.id);
      if (attempted)
        throw new Error(
          "A Page creation was already attempted for this account. Verify its result and connect the existing Page; do not register it again.",
        );
    }
    if (profile ? !this.automated : !this.plain)
      throw new Error("Chrome or Edge is unavailable on this host.");
    const current = this.active.get(account.id);
    if (current) {
      if (current.record.intent !== input.intent)
        throw new Error("Close or cancel the account's current browser workflow first.");
      return copy(current.record);
    }
    const record: SocialBrowserWorkflow = {
      id: randomUUID(),
      accountId: account.id,
      platform: account.platform,
      intent: input.intent,
      status: "queued",
      outcome: "unverified",
      createdAt: this.now(),
      updatedAt: this.now(),
      expiresAt: this.now() + TIMEOUT,
    };
    const active: Active = {
      record,
      cancelled: false,
      closed: false,
      ...(profile ? { profile } : {}),
    };
    this.active.set(account.id, active);
    try {
      await this.save(service, record);
    } catch (error) {
      this.active.delete(account.id);
      active.profile = undefined;
      throw error;
    }
    void this.exclusive(account.id, async () => {
      if (active.cancelled) return;
      if (this.now() >= record.expiresAt) {
        record.status = "expired";
        await this.save(service, record);
        return;
      }
      await this.beforeAction(service, principal, active, !!profile);
      const session = profile ? await this.automated!(this.profile(account), false) : undefined;
      const window = session ?? (await this.plain!(this.profile(account), url));
      active.close = () => window.close();
      void window.closed.then(() => {
        active.closed = true;
      });
      try {
        if (active.cancelled || this.stopped) return;
        if (session) {
          active.page = session.page;
          await this.beforeAction(service, principal, active);
          await session.page.goto(url);
          await this.serialize(active, () => this.prepareRegistration(service, principal, active));
        }
        if (active.cancelled || this.stopped) return;
        if (!session) {
          record.status = "awaiting_owner";
          await this.save(service, record);
        }
        while (
          !active.closed &&
          !active.cancelled &&
          !this.stopped &&
          this.now() < record.expiresAt
        )
          await this.wait(1000);
        if (RUNNING.has(record.status))
          record.status = active.cancelled
            ? "cancelled"
            : active.closed
              ? "window_closed"
              : "expired";
        await this.save(service, record);
      } finally {
        if (!active.closed) await window.close();
        active.page = undefined;
        active.profile = undefined;
      }
    })
      .catch(async (error) => this.failed(service, active, error))
      .finally(() => {
        if (this.active.get(account.id) === active) this.active.delete(account.id);
      });
    return copy(record);
  }
  async advanceRegistration(
    service: SocialService,
    principal: SocialPrincipal,
    input: {
      accountId: string;
      workflowId: string;
      expectedUpdatedAt: number;
      registration: unknown;
    },
  ): Promise<SocialBrowserWorkflow> {
    await this.account(service, principal, input.accountId);
    const active = this.active.get(input.accountId);
    if (
      !active ||
      active.record.intent !== "signup" ||
      active.record.status !== "awaiting_owner" ||
      !active.page ||
      !active.profile
    )
      throw new Error("The registration window is not active. Start a new signup workflow.");
    const profile = parseRegistrationProfile(input.registration);
    return await this.serialize(active, async () => {
      if (
        input.workflowId !== active.record.id ||
        !Number.isSafeInteger(input.expectedUpdatedAt) ||
        input.expectedUpdatedAt !== active.record.updatedAt
      )
        throw new Error("The registration workflow changed. Refresh its status before resuming.");
      if (active.record.registrationSubmission)
        throw new Error(
          "Page creation has already been attempted. Its result must be verified without another submission.",
        );
      try {
        await this.beforeAction(service, principal, active);
        active.review = undefined;
        active.profile = { ...active.profile, ...profile };
        await this.prepareRegistration(service, principal, active);
        return copy(active.record);
      } catch (error) {
        await this.failed(service, active, error);
        throw error;
      }
    });
  }
  private registrationActive(accountId: string, workflowId: string, expectedUpdatedAt: number) {
    const active = this.active.get(accountId);
    if (
      !active ||
      active.record.intent !== "signup" ||
      active.record.status !== "awaiting_owner" ||
      !active.page ||
      !active.profile ||
      active.record.platform !== "linkedin" ||
      active.profile.accountKind === "person"
    )
      throw new Error("A supported LinkedIn Page registration window is not active.");
    if (
      workflowId !== active.record.id ||
      !Number.isSafeInteger(expectedUpdatedAt) ||
      expectedUpdatedAt !== active.record.updatedAt
    )
      throw new Error("The registration workflow changed. Refresh before approving creation.");
    if (active.record.registrationSubmission)
      throw new Error("Page creation was already attempted. Do not submit it again.");
    return active;
  }
  async reviewRegistration(
    service: SocialService,
    principal: SocialPrincipal,
    input: {
      accountId: string;
      workflowId: string;
      expectedUpdatedAt: number;
    },
  ): Promise<SocialRegistrationReview> {
    await this.account(service, principal, input.accountId);
    const active = this.registrationActive(
      input.accountId,
      input.workflowId,
      input.expectedUpdatedAt,
    );
    return this.serialize(active, async () => {
      this.registrationActive(input.accountId, input.workflowId, input.expectedUpdatedAt);
      active.review = undefined;
      await this.beforeAction(service, principal, active);
      const snapshot = await reviewLinkedInPageRegistration(active.page!, active.profile!, {
        beforeAction: () => this.beforeAction(service, principal, active),
      });
      await this.beforeAction(service, principal, active);
      const { controls: _controls, ...visible } = snapshot;
      const review: SocialRegistrationReview = {
        ...visible,
        platform: "linkedin",
        reviewId: randomUUID(),
        accountId: input.accountId,
        workflowId: active.record.id,
        updatedAt: active.record.updatedAt,
        expiresAt: Math.min(active.record.expiresAt, this.now() + 2 * 60_000),
      };
      active.review = {
        public: review,
        snapshot,
        digest: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
      };
      return JSON.parse(JSON.stringify(review));
    });
  }
  async submitRegistration(
    service: SocialService,
    principal: SocialPrincipal,
    input: {
      accountId: string;
      workflowId: string;
      expectedUpdatedAt: number;
      reviewId: unknown;
      confirm: unknown;
    },
  ): Promise<SocialBrowserWorkflow> {
    await this.account(service, principal, input.accountId);
    const active = this.registrationActive(
      input.accountId,
      input.workflowId,
      input.expectedUpdatedAt,
    );
    return this.serialize(active, async () => {
      this.registrationActive(input.accountId, input.workflowId, input.expectedUpdatedAt);
      const review = active.review;
      if (
        input.confirm !== "CREATE_LINKEDIN_PAGE" ||
        !review ||
        input.reviewId !== review.public.reviewId ||
        this.now() >= review.public.expiresAt
      )
        throw new Error(
          "Review the exact Page administrator, fields and terms before approving creation.",
        );
      active.review = undefined;
      await this.beforeAction(service, principal, active);
      const current = await reviewLinkedInPageRegistration(active.page!, active.profile!, {
        beforeAction: () => this.beforeAction(service, principal, active),
      });
      if (createHash("sha256").update(JSON.stringify(current)).digest("hex") !== review.digest)
        throw new Error("The approved Page form or administrator changed. Review it again.");
      await this.beforeAction(service, principal, active);
      active.record.registrationSubmission = {
        id: randomUUID(),
        state: "attempting",
        attemptedAt: this.now(),
        reviewDigest: review.digest,
        expectedResourceDigest: expectedLinkedInResourceDigest(review.snapshot),
      };
      try {
        // This durable checkpoint is intentionally before the agreement checkbox and Create action.
        await this.save(service, active.record);
        await this.beforeAction(service, principal, active);
        const receipt = await submitLinkedInPageRegistration(
          active.page!,
          active.profile!,
          review.snapshot,
          {
            beforeAction: () => this.beforeAction(service, principal, active),
          },
        );
        active.record.registrationSubmission = {
          ...active.record.registrationSubmission,
          state: "created",
          ...receipt,
        };
        active.record.registration = {
          status: "awaiting_owner",
          step: "admin_setup",
          blockers: [],
          requiredFields: [],
          filledFields: [],
          canAdvance: false,
          message:
            "The LinkedIn Page was created and read back. Connect the existing Page separately; do not create it again.",
        };
        await this.save(service, active.record);
        return copy(active.record);
      } catch (error) {
        active.record.registrationSubmission = {
          ...active.record.registrationSubmission!,
          state: "unknown",
        };
        if (error instanceof WorkflowInterruption || active.cancelled || this.stopped) {
          await this.save(service, active.record).catch(() => undefined);
          await this.failed(service, active, error);
        } else {
          active.record.status = "awaiting_owner";
          active.record.error =
            "Page creation could not be verified. Inspect the same browser window; this submission will not be repeated.";
          active.record.registration = {
            status: "awaiting_owner",
            step: "admin_setup",
            blockers: [],
            requiredFields: [],
            filledFields: [],
            canAdvance: false,
            message: active.record.error,
          };
          await this.save(service, active.record).catch(() => undefined);
        }
        throw new Error(
          "Page creation could not be verified. Inspect LinkedIn before any further action; this submission will not be repeated.",
        );
      }
    });
  }
  /** Reconciles an already-attempted resource by reading it; this never reopens Create. */
  async reconcileRegistration(
    service: SocialService,
    principal: SocialPrincipal,
    input: {
      accountId: string;
      workflowId: string;
      expectedUpdatedAt: number;
      resourceId: unknown;
    },
  ): Promise<SocialBrowserWorkflow> {
    const account = await this.account(service, principal, input.accountId);
    if (account.platform !== "linkedin" || account.accountType !== "organization")
      throw new Error("Only a LinkedIn organization Page creation can be reconciled.");
    if (typeof input.resourceId !== "string" || !/^[1-9]\d{0,19}$/.test(input.resourceId))
      throw new Error("Enter the existing LinkedIn Page's numeric ID.");
    if (!Number.isSafeInteger(input.expectedUpdatedAt))
      throw new Error("Invalid workflow revision.");
    const resourceId = input.resourceId;
    const load = async () => {
      const row = await service.store.db
        .prepare(
          "SELECT value FROM social_records WHERE kind='browser-workflow' AND id=? AND json_extract(value,'$.accountId')=?",
        )
        .get(input.workflowId, input.accountId);
      if (!row) throw new Error("The retained Page creation record could not be found.");
      return JSON.parse(String(row.value)) as SocialBrowserWorkflow;
    };
    const record = await load();
    const eligible = (current: SocialBrowserWorkflow) => {
      if (
        current.id !== input.workflowId ||
        current.accountId !== account.id ||
        current.platform !== "linkedin" ||
        current.intent !== "signup" ||
        !current.registrationSubmission ||
        !["unknown", "attempting"].includes(current.registrationSubmission.state)
      )
        throw new Error("Only an unresolved Page creation attempt can be reconciled.");
      if (current.updatedAt !== input.expectedUpdatedAt)
        throw new Error(
          "The registration workflow changed. Refresh its status before checking the Page.",
        );
      if (!/^[a-f0-9]{64}$/.test(current.registrationSubmission.expectedResourceDigest ?? ""))
        throw new Error(
          "This older attempt has no retained resource digest. Inspect LinkedIn manually; automatic reconciliation is unavailable.",
        );
    };
    eligible(record);
    if (this.stopped) throw new Error("The browser workflow host is stopping.");
    if (this.reconciliations.has(account.id))
      throw new Error("The existing Page result is already being checked.");
    if (this.isLoginWaiting(account.id))
      throw new Error(
        "Finish or cancel the account's current login before checking the existing Page.",
      );
    const active = this.active.get(account.id);
    if (
      active &&
      (!active.page || active.closed || active.cancelled || !RUNNING.has(active.record.status))
    )
      throw new Error(
        "Finish or cancel the current browser window before checking the existing Page.",
      );
    if (!active && !this.automated) throw new Error("Chrome or Edge is unavailable on this host.");
    const pending: Reconciliation = { cancelled: false, active };
    this.reconciliations.set(account.id, pending);
    let closed = false;
    const authority = async () => {
      if (
        this.stopped ||
        pending.cancelled ||
        closed ||
        this.reconciliations.get(account.id) !== pending
      )
        throw new Error(
          "The existing Page check was interrupted. Its unresolved result was preserved.",
        );
      if (this.isLoginWaiting(account.id))
        throw new Error(
          "Finish or cancel the account's current login before checking the existing Page.",
        );
      if (
        active &&
        (this.active.get(account.id) !== active ||
          active.cancelled ||
          active.closed ||
          !RUNNING.has(active.record.status) ||
          this.now() >= active.record.expiresAt ||
          !active.page)
      )
        throw new Error(
          "The current browser workflow changed. Its unresolved result was preserved.",
        );
      const current = await this.account(service, principal, account.id);
      if (JSON.stringify(current) !== JSON.stringify(account))
        throw new Error(
          "The account changed while checking the existing Page. Refresh before trying again.",
        );
      if (
        current.platformId &&
        ![`web:linkedin:company:${resourceId}`, `urn:li:organization:${resourceId}`].includes(
          current.platformId,
        )
      )
        throw new Error("The connected organization does not match this existing Page.");
      await service.store.db.checkAuthorization();
      if (this.stopped || pending.cancelled || closed)
        throw new Error("The existing Page check was interrupted.");
    };
    const beforeRead = async () => {
      await authority();
      const current = await load();
      eligible(current);
      if (
        current.registrationSubmission?.id !== record.registrationSubmission?.id ||
        current.registrationSubmission?.expectedResourceDigest !==
          record.registrationSubmission?.expectedResourceDigest
      )
        throw new Error("The retained Page attempt changed. Refresh before checking it again.");
    };
    const read = async (page: BrowserPage) => {
      await beforeRead();
      const existing = await readExistingLinkedInPageRegistration(page, resourceId, beforeRead);
      if (
        expectedLinkedInResourceDigest(existing) !==
        record.registrationSubmission!.expectedResourceDigest
      )
        throw new Error(
          "The existing Page name, username or administrator does not match the attempted creation. Its result remains unresolved.",
        );
      await beforeRead();
      const confirmed = await service.store.transaction(async () => {
        await beforeRead();
        const current = await load();
        eligible(current);
        current.registrationSubmission = {
          ...current.registrationSubmission!,
          state: "created",
          resourceId: existing.resourceId,
          resourceUrl: existing.resourceUrl,
        };
        delete current.error;
        current.registration = {
          status: "awaiting_owner",
          step: "admin_setup",
          blockers: [],
          requiredFields: [],
          filledFields: [],
          canAdvance: false,
          message:
            "The existing LinkedIn Page was read back and matched the attempted creation. Host connection remains separate; do not create it again.",
        };
        await authority();
        await this.save(service, current);
        await authority();
        return current;
      });
      // Keep the original object: the window lifecycle also retains a reference to it.
      if (active?.record.id === confirmed.id) Object.assign(active.record, copy(confirmed));
      return copy(confirmed);
    };
    try {
      if (active)
        return await this.serialize(active, async () => {
          await beforeRead();
          return read(active.page!);
        });
      return await this.exclusive(account.id, async () => {
        await beforeRead();
        if (this.active.has(account.id))
          throw new Error("Finish or cancel the current browser workflow first.");
        const session = await this.automated!(this.profile(account), false);
        let closing = false;
        pending.close = async () => {
          if (!closing) {
            closing = true;
            await session.close();
          }
        };
        void session.closed.then(() => {
          closed = true;
        });
        try {
          return await read(session.page);
        } finally {
          await pending.close();
        }
      });
    } finally {
      if (this.reconciliations.get(account.id) === pending) this.reconciliations.delete(account.id);
    }
  }
  async cancel(
    service: SocialService,
    principal: SocialPrincipal,
    accountId: string,
  ): Promise<void> {
    await this.account(service, principal, accountId);
    await this.cancelAccount(service, accountId);
  }
  async cancelAccount(service: SocialService, accountId: string): Promise<void> {
    const reconciliation = this.reconciliations.get(accountId);
    if (reconciliation) {
      reconciliation.cancelled = true;
      await reconciliation.close?.();
    }
    const active = this.active.get(accountId);
    if (!active) return;
    active.cancelled = true;
    active.record.status = "cancelled";
    try {
      await this.save(service, active.record);
    } finally {
      await active.close?.();
    }
  }
  hasActive(accountId: string) {
    return this.active.has(accountId) || this.reconciliations.has(accountId);
  }
  async stop(service: SocialService): Promise<void> {
    this.stopped = true;
    for (const reconciliation of this.reconciliations.values()) {
      reconciliation.cancelled = true;
      void reconciliation.close?.().catch(() => undefined);
    }
    for (const active of this.active.values()) {
      active.record.status = "interrupted";
      active.cancelled = true;
    }
    for (const active of this.active.values()) {
      await this.save(service, active.record, true).catch(() => undefined);
      void active.close?.().catch(() => undefined);
    }
  }
}
