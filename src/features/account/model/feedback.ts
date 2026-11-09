import {
  AccountApiError,
  FeedbackCreate,
  type AccountClient,
  type FeedbackContext,
} from "@bycoda/account-contracts";
import type { NativeDeviceInfo } from "./accountNative";

export const FEEDBACK_KINDS = ["idea", "problem", "praise", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** Limit of the contract (`FeedbackCreate`). */
export const FEEDBACK_MESSAGE_MAX = 2000;

export type FeedbackDraft = {
  kind: FeedbackKind;
  message: string;
  /** 1 to 5, or null when the user gave none. */
  rating: number | null;
  /** The "Include app version and system" tick; off by default. */
  includeContext: boolean;
};
export const EMPTY_FEEDBACK_DRAFT: FeedbackDraft = {
  kind: "idea",
  message: "",
  rating: null,
  includeContext: false,
};

export type FeedbackDraftIssue = "message-missing" | "message-long";

/** What is wrong with the draft, checked against the limits the contract enforces. */
export function validateFeedbackDraft(draft: FeedbackDraft): FeedbackDraftIssue[] {
  const length = draft.message.trim().length;
  if (length === 0) return ["message-missing"];
  if (length > FEEDBACK_MESSAGE_MAX) return ["message-long"];
  return [];
}

export type FeedbackSubmitResult =
  | { status: "sent"; reference: string }
  | { status: "invalid"; issues: FeedbackDraftIssue[] }
  | { status: "rate-limited" }
  | { status: "failed" };

export type FeedbackDeps = {
  /** Version, platform, OS and channel; only asked for when the user ticked the box. */
  deviceInfo: () => Promise<NativeDeviceInfo>;
  onFailure?: (error: unknown) => unknown;
};

/**
 * Sends the user's own words, the optional rating and, only when ticked, the app version,
 * platform, OS version and channel. Signed-in users use the account route, guests the
 * anonymous one. Every non-sent result leaves the draft with the caller.
 */
export async function submitFeedback(
  api: Pick<AccountClient, "sendFeedback" | "sendAnonymousFeedback">,
  draft: FeedbackDraft,
  signedIn: boolean,
  deps: FeedbackDeps,
): Promise<FeedbackSubmitResult> {
  const issues = validateFeedbackDraft(draft);
  if (issues.length > 0) return { status: "invalid", issues };
  try {
    let context: FeedbackContext | undefined;
    if (draft.includeContext) {
      const info = await deps.deviceInfo();
      context = {
        appVersion: info.appVersion,
        platform: info.platform,
        osVersion: info.osVersion,
        channel: info.channel,
      };
    }
    const body = FeedbackCreate.safeParse({
      kind: draft.kind,
      message: draft.message,
      ...(draft.rating !== null ? { rating: draft.rating } : {}),
      ...(context ? { context } : {}),
    });
    if (!body.success) return { status: "failed" };
    const receipt = signedIn
      ? await api.sendFeedback({ body: body.data })
      : await api.sendAnonymousFeedback({ body: body.data });
    return { status: "sent", reference: receipt.id };
  } catch (error) {
    if (error instanceof AccountApiError && error.code === "rate_limited") {
      return { status: "rate-limited" };
    }
    try {
      await deps.onFailure?.(error);
    } catch {
      // -- the failure is already reported as `failed`; a second error adds nothing.
    }
    return { status: "failed" };
  }
}
