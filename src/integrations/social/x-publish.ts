import { xPostWeight } from "./publishingFormats";

export const X_POST_WEIGHT_LIMIT = 280;

export type XPostExtras = {
  quotePostId?: string;
  communityId?: string;
  poll?: { options: string[]; durationMinutes: number };
  /** Posts after the opening post, in publication order. */
  thread?: string[];
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shared draft and dispatch validation. Check the exact shape before any media uploads. */
export function xPostExtrasIssue(extras: unknown, mediaCount = 0): string | undefined {
  if (
    !record(extras) ||
    Object.keys(extras).some(
      (key) => !["quotePostId", "communityId", "poll", "thread"].includes(key),
    )
  )
    return "Invalid X publishing options.";
  const { quotePostId, communityId, poll, thread } = extras;
  if (
    quotePostId !== undefined &&
    (typeof quotePostId !== "string" || !/^\d{1,19}$/.test(quotePostId))
  )
    return "Quote post ID must be numeric.";
  if (
    communityId !== undefined &&
    (typeof communityId !== "string" || !/^\d{1,19}$/.test(communityId))
  )
    return "Community ID must be numeric.";
  if (poll !== undefined) {
    if (
      !record(poll) ||
      Object.keys(poll).some((key) => !["options", "durationMinutes"].includes(key))
    )
      return "Invalid X publishing options.";
    const { options, durationMinutes } = poll;
    if (!Array.isArray(options) || options.length < 2 || options.length > 4)
      return "An X poll needs two to four options.";
    if (
      options.some(
        (option) => typeof option !== "string" || !option.trim() || Array.from(option).length > 25,
      )
    )
      return "Each X poll option must be 1 to 25 characters.";
    if (
      typeof durationMinutes !== "number" ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 5 ||
      durationMinutes > 10080
    )
      return "An X poll lasts 5 minutes to 7 days.";
    if (mediaCount || quotePostId) return "An X poll cannot include media or a quote.";
  }
  if (
    thread !== undefined &&
    (!Array.isArray(thread) ||
      thread.length < 1 ||
      thread.length > 24 ||
      thread.some(
        (item) =>
          typeof item !== "string" || !item.trim() || xPostWeight(item) > X_POST_WEIGHT_LIMIT,
      ))
  )
    return "An X thread allows 1 to 24 additional posts, each up to 280 characters.";
}

export function hasXPostExtras(extras: XPostExtras | undefined): boolean {
  return !!(extras?.quotePostId || extras?.communityId || extras?.poll || extras?.thread?.length);
}
