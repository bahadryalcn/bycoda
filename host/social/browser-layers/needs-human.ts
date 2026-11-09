import { randomUUID } from "node:crypto";
import { IndexedRecords, type SettingsStore } from "./record-index";
import type { NeedsHumanItem, NeedsHumanKind } from "./types";
import type { SocialPrincipal } from "../social";

const ITEMS = "browser-layers.needs-human";

export type NeedsHumanInput = {
  accountId: string;
  kind: NeedsHumanKind;
  url: string;
  jobId?: string;
  screenshotId?: string;
};

export type NeedsHumanHooks = {
  /** Called after an item is stored. The UI turns it into a notice; failures are ignored. */
  onOpened?(item: NeedsHumanItem): void;
  /** Called after the owner resolves an item. Moving the job from review back to queued belongs here. */
  onResolved?(item: NeedsHumanItem): Promise<void> | void;
};

/**
 * Accounts waiting for a person. The Host never solves captcha, verification or login pages; it records
 * the item, keeps the screenshot identity, and resumes the job only after the owner says it is done.
 */
export class NeedsHumanQueue {
  private readonly records: IndexedRecords<NeedsHumanItem>;

  constructor(
    store: SettingsStore,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = randomUUID,
    private readonly hooks: NeedsHumanHooks = {},
  ) {
    this.records = new IndexedRecords(store, ITEMS);
  }

  /** One open item per account, kind and job. A repeated detection returns the open item. */
  async open(input: NeedsHumanInput): Promise<NeedsHumanItem> {
    const { item, created } = await this.records.serial(async () => {
      const open = (await this.records.list()).find(
        (row) =>
          row.resolvedAt === undefined &&
          row.accountId === input.accountId &&
          row.kind === input.kind &&
          row.jobId === input.jobId,
      );
      if (open) return { item: open, created: false };
      const fresh: NeedsHumanItem = {
        id: this.newId(),
        accountId: input.accountId,
        kind: input.kind,
        url: input.url,
        createdAt: this.now(),
        ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
        ...(input.screenshotId === undefined ? {} : { screenshotId: input.screenshotId }),
      };
      return { item: await this.records.put(fresh), created: true };
    });
    if (created) {
      try {
        this.hooks.onOpened?.(item);
      } catch {
        // A notice failure must not lose the item.
      }
    }
    return item;
  }

  /** Open items only, oldest first. */
  async list(): Promise<NeedsHumanItem[]> {
    return (await this.records.list())
      .filter((item) => item.resolvedAt === undefined)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async openCount(): Promise<number> {
    return (await this.list()).length;
  }

  /** Owner only. Resolving an item twice returns the stored item without a second resume. */
  async resolve(id: string, principal: SocialPrincipal): Promise<NeedsHumanItem> {
    if (principal.kind !== "owner")
      throw new Error("Only the owner can resolve a waiting browser task.");
    const { item, changed } = await this.records.serial(async () => {
      const current = await this.records.get(id);
      if (!current) throw new Error("Waiting browser task was not found.");
      if (current.resolvedAt !== undefined) return { item: current, changed: false };
      return {
        item: await this.records.put({ ...current, resolvedAt: this.now() }),
        changed: true,
      };
    });
    if (changed) await this.hooks.onResolved?.(item);
    return item;
  }
}
