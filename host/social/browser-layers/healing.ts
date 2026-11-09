import { randomUUID } from "node:crypto";
import type { SocialPlatform } from "../../../src/features/social/model/social";
import { IndexedRecords, type SettingsStore } from "./record-index";
import { isSafeCandidateSelector } from "./screen-summary";
import type { RecipeSuggestion } from "./types";

const SUGGESTIONS = "browser-layers.suggestion";
const STEP = /^[A-Za-z0-9_.-]{1,80}$/;
const overrideKey = (platform: SocialPlatform, step: string) =>
  `browser-layers.override.${platform}.${step}`;

export type RecipeSuggestionInput = {
  accountId: string;
  platform: SocialPlatform;
  step: string;
  selector: string;
  source: "decision" | "desktop";
};

function valid(input: RecipeSuggestionInput): boolean {
  return STEP.test(input.step) && isSafeCandidateSelector(input.selector);
}

/**
 * Self-healing suggestions. A path that worked on layer 3 or 4 becomes a pending suggestion.
 * Nothing is applied until the owner approves it, and only an approved suggestion becomes an override.
 */
export class RecipeHealing {
  private readonly records: IndexedRecords<RecipeSuggestion>;

  constructor(
    private readonly store: SettingsStore,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = randomUUID,
  ) {
    this.records = new IndexedRecords(store, SUGGESTIONS);
  }

  /** Records a pending suggestion. An identical pending suggestion is returned instead of a duplicate. */
  async suggest(input: RecipeSuggestionInput): Promise<RecipeSuggestion | undefined> {
    if (!valid(input)) return undefined;
    return this.records.serial(async () => {
      const same = (await this.records.list()).find(
        (item) =>
          item.status === "pending" &&
          item.accountId === input.accountId &&
          item.platform === input.platform &&
          item.step === input.step &&
          item.selector === input.selector,
      );
      if (same) return same;
      return this.records.put({
        ...input,
        id: this.newId(),
        createdAt: this.now(),
        status: "pending",
      });
    });
  }

  async list(): Promise<RecipeSuggestion[]> {
    return (await this.records.list()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Owner only. Approval writes the override that recipes read through `getRecipeOverride`.
   * Async so a refusal rejects the returned promise, like every other method here.
   */
  async approve(id: string, principal: { owner: boolean }): Promise<RecipeSuggestion> {
    if (!principal.owner) throw new Error("Only the owner can approve a recipe change.");
    return this.decide(id, "approved");
  }

  async reject(id: string, principal: { owner: boolean }): Promise<RecipeSuggestion> {
    if (!principal.owner) throw new Error("Only the owner can reject a recipe change.");
    return this.decide(id, "rejected");
  }

  private decide(id: string, status: "approved" | "rejected"): Promise<RecipeSuggestion> {
    return this.records.serial(async () => {
      const record = await this.records.get(id);
      if (!record) throw new Error("Recipe suggestion was not found.");
      if (record.status !== "pending") throw new Error("Recipe suggestion is already decided.");
      if (status === "approved")
        await this.store.putSetting(
          overrideKey(record.platform, record.step),
          JSON.stringify({
            selector: record.selector,
            suggestionId: record.id,
            approvedAt: this.now(),
          }),
        );
      return this.records.put({ ...record, status });
    });
  }
}

/** The approved selector for one platform step, or undefined. Unapproved suggestions never appear here. */
export async function getRecipeOverride(
  store: SettingsStore,
  platform: SocialPlatform,
  step: string,
): Promise<string | undefined> {
  if (!STEP.test(step)) return undefined;
  const raw = await store.getSetting(overrideKey(platform, step));
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as { selector?: unknown };
    return typeof parsed.selector === "string" && isSafeCandidateSelector(parsed.selector)
      ? parsed.selector
      : undefined;
  } catch {
    return undefined;
  }
}
