import type { SocialPlatform } from "../../../src/features/social/model/social";

/** Layers tried in order by the layered driver. The API layer runs in the adapter before the driver. */
export type LayerName = "api" | "recipe" | "decision" | "desktop";

export type LayerOutcome = {
  layer: LayerName;
  status: "done" | "unexpected_screen" | "needs_human" | "failed" | "skipped";
  durationMs: number;
  /** Fixed reason codes only; never page text, field values or URLs. */
  detail?: string;
};

/** Thrown by a recipe when a required element is missing, so the driver can hand the page to the next layer. */
export class UnexpectedScreen extends Error {
  constructor(public readonly snapshot: ScreenSummary) {
    super("Unexpected browser screen.");
    this.name = "UnexpectedScreen";
  }
}

/** Text-only summary of a page. It never carries cookies, field values or query strings. */
export type ScreenSummary = {
  url: string;
  title: string;
  buttons: string[];
  fields: string[];
  headings: string[];
  errors: string[];
};

export type NeedsHumanKind =
  | "captcha"
  | "verification"
  | "suspicious_login"
  | "login"
  | "unexpected";

export type NeedsHumanItem = {
  id: string;
  accountId: string;
  jobId?: string;
  kind: NeedsHumanKind;
  url: string;
  screenshotId?: string;
  createdAt: number;
  resolvedAt?: number;
};

/**
 * One recipe step. `outreach` must be exactly `false` for a single job before the desktop layer may
 * run; `undefined` is treated as outreach (fail closed).
 */
export type LayerStep<T> = {
  name: string;
  recipe: () => Promise<T>;
  outreach?: boolean;
  jobId?: string;
};

export interface LayeredBrowserDriver {
  run<T>(accountId: string, step: LayerStep<T>): Promise<T>;
}

export type BrowserVisibility = "hidden" | "visible";

export type RecipeSuggestion = {
  id: string;
  accountId: string;
  platform: SocialPlatform;
  step: string;
  selector: string;
  source: "decision" | "desktop";
  createdAt: number;
  status: "pending" | "approved" | "rejected";
};
