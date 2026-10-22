import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { SocialAccount } from "../src/features/social/model/social";
import {
  socialBrowserUrl,
  type SocialBrowserIntent,
  type SocialBrowserState,
  type SocialBrowserWorkflow,
} from "../src/features/social/model/socialBrowser";
import type { PlainBrowserLauncher } from "./social-browser";
import type { SocialPrincipal, SocialService } from "./social";

type Active = { record: SocialBrowserWorkflow; cancelled: boolean; close?: () => Promise<void> };
const RUNNING = new Set(["queued", "awaiting_owner"]);
const TIMEOUT = 20 * 60_000;

/** Durable owner-assisted browser work, isolated from automatic social send permissions. */
export class SocialBrowserWorkflows {
  private active = new Map<string, Active>();
  private stopped = false;
  constructor(
    private readonly plain: PlainBrowserLauncher | undefined,
    private readonly profile: (account: SocialAccount) => string,
    private readonly exclusive: <T>(accountId: string, action: () => Promise<T>) => Promise<T>,
    private readonly now = Date.now,
    private readonly wait: (ms: number) => Promise<unknown> = sleep,
  ) {}

  private account(service: SocialService, principal: SocialPrincipal, id: string): SocialAccount {
    if (principal.kind !== "owner") throw new Error("Browser workflows require the owner device.");
    const account = service.accountForOAuth(principal, id);
    if (account.executorId !== service.store.environmentId)
      throw new Error("Open the browser workflow on the account's executor host.");
    return account;
  }
  private records(service: SocialService, accountId: string): SocialBrowserWorkflow[] {
    return service.store.db
      .prepare(
        "SELECT value FROM social_records WHERE kind='browser-workflow' AND json_extract(value,'$.accountId')=? ORDER BY json_extract(value,'$.createdAt') DESC, rowid DESC LIMIT 20",
      )
      .all(accountId)
      .map((row) => JSON.parse(String(row.value)) as SocialBrowserWorkflow);
  }
  private save(service: SocialService, record: SocialBrowserWorkflow) {
    if (this.stopped) return;
    record.updatedAt = this.now();
    service.store.db
      .prepare(
        "INSERT INTO social_records(kind,id,value) VALUES('browser-workflow',?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value",
      )
      .run(record.id, JSON.stringify(record));
    // Retain bounded workflow metadata only: no cookies, entered fields, page text or target URLs.
    service.store.db
      .prepare(
        "DELETE FROM social_records WHERE kind='browser-workflow' AND json_extract(value,'$.accountId')=? AND id NOT IN (SELECT id FROM social_records WHERE kind='browser-workflow' AND json_extract(value,'$.accountId')=? ORDER BY json_extract(value,'$.createdAt') DESC, rowid DESC LIMIT 20)",
      )
      .run(record.accountId, record.accountId);
  }
  status(
    service: SocialService,
    principal: SocialPrincipal,
    accountId: string,
  ): SocialBrowserState {
    this.account(service, principal, accountId);
    const workflows = this.records(service, accountId);
    for (const record of workflows) {
      if (RUNNING.has(record.status) && this.active.get(accountId)?.record.id !== record.id) {
        record.status = "interrupted";
        this.save(service, record);
      }
    }
    return {
      available: !!this.plain,
      reason: this.plain
        ? "Owner-assisted browser workflows are available."
        : "Install Chrome or Edge on the executor host.",
      workflows,
    };
  }
  begin(
    service: SocialService,
    principal: SocialPrincipal,
    input: {
      accountId: string;
      intent: SocialBrowserIntent;
      targetUrl?: unknown;
      acknowledgeRisk?: unknown;
    },
  ): SocialBrowserWorkflow {
    const account = this.account(service, principal, input.accountId);
    if (this.stopped) throw new Error("The browser workflow host is stopping.");
    if (input.acknowledgeRisk !== true)
      throw new Error("Acknowledge the browser workflow before opening it.");
    const url = socialBrowserUrl(account.platform, input.intent, input.targetUrl);
    if (!this.plain) throw new Error("Chrome or Edge is unavailable on this host.");
    const current = this.active.get(account.id);
    if (current) {
      if (current.record.intent !== input.intent)
        throw new Error("Close or cancel the account's current browser workflow first.");
      return { ...current.record };
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
    const active: Active = { record, cancelled: false };
    this.active.set(account.id, active);
    this.save(service, record);
    void this.exclusive(account.id, async () => {
      if (active.cancelled) return;
      if (this.now() >= record.expiresAt) {
        record.status = "expired";
        this.save(service, record);
        return;
      }
      const window = await this.plain!(this.profile(account), url);
      active.close = () => window.close();
      if (active.cancelled || this.stopped) {
        await window.close();
        return;
      }
      record.status = "awaiting_owner";
      this.save(service, record);
      let closed = false;
      void window.closed.then(() => {
        closed = true;
      });
      try {
        while (!closed && !active.cancelled && !this.stopped && this.now() < record.expiresAt)
          await this.wait(1000);
        record.status = active.cancelled ? "cancelled" : closed ? "window_closed" : "expired";
        this.save(service, record);
      } finally {
        if (!closed) await window.close();
      }
    })
      .catch(() => {
        if (!active.cancelled && !this.stopped) {
          record.status = "failed";
          record.error =
            "The browser workflow could not finish. Check the executor host and try again.";
          this.save(service, record);
        }
      })
      .finally(() => {
        if (this.active.get(account.id) === active) this.active.delete(account.id);
      });
    return { ...record };
  }
  async cancel(
    service: SocialService,
    principal: SocialPrincipal,
    accountId: string,
  ): Promise<void> {
    this.account(service, principal, accountId);
    await this.cancelAccount(service, accountId);
  }
  async cancelAccount(service: SocialService, accountId: string): Promise<void> {
    const active = this.active.get(accountId);
    if (!active) return;
    active.cancelled = true;
    active.record.status = "cancelled";
    this.save(service, active.record);
    await active.close?.();
  }
  hasActive(accountId: string) {
    return this.active.has(accountId);
  }
  stop(service: SocialService): void {
    for (const active of this.active.values()) {
      active.record.status = "interrupted";
      this.save(service, active.record);
      active.cancelled = true;
      void active.close?.().catch(() => undefined);
    }
    this.stopped = true;
  }
}
