import { HarnessLoginError } from "../../../integrations/harness/core/authErrors";
import { redactExitStderrLine } from "../../../integrations/harness/core/exitDiagnostics";
import { t } from "../../../shared/i18n";
import { HARNESS_TITLE, type HarnessId } from "../../../shared/model/harnessIdentity";

/** What a provider account operation failed at; the presenter picks the sentence from this. */
export type ProviderAccountErrorCode =
  /** Login finished but the profile's signed-in identity could not be read. */
  | "identityUnverified"
  /** Another profile of the provider already holds this sign-in. `label` names it. */
  | "duplicate"
  /** A sign-in for this provider is already running. */
  | "registrationInProgress"
  /** The failed profile's temporary credentials could not be removed. `cause` is the failure. */
  | "cleanupFailed"
  /** The profile was removed while the operation was open. */
  | "accountMissing"
  /** The CLI signed in but the account's usage lookup still reports signed out. */
  | "signInUnverified";

/** The operation a screen was running, used only when an error carries no code of its own. */
export type ProviderAccountAction = "save" | "signIn" | "remove" | "makeDefault";

/**
 * A provider account failure with a stable `code`. `message` stays the English sentence for
 * logs and tests; screens call `presentProviderAccountError`. Never put an email, token or
 * path in `label` or `detail`: they are shown as given.
 */
export class ProviderAccountError extends Error {
  readonly code: ProviderAccountErrorCode;
  /** Profile label for `duplicate`. */
  readonly label: string | undefined;
  readonly harness: HarnessId | undefined;
  /** Redacted provider-owned text, shown verbatim as secondary detail. */
  readonly detail: string | undefined;

  constructor(
    code: ProviderAccountErrorCode,
    message: string,
    options: { label?: string; harness?: HarnessId; detail?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProviderAccountError";
    this.code = code;
    this.label = options.label;
    this.harness = options.harness;
    this.detail = options.detail;
  }
}

/** A localized sentence plus the provider's own redacted wording, when there is some. */
export type ProviderAccountErrorPresentation = { summary: string; detail?: string };

const DETAIL_MAX = 240;

/** Provider- and OS-owned text keeps its wording but loses credentials, links and control bytes. */
export function safeProviderAccountDetail(value: unknown): string | undefined {
  const raw = typeof value === "string" ? value : value instanceof Error ? value.message : "";
  const text = redactExitStderrLine(raw.replace(/https?:\/\/\S+/gi, "link"))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text;
}

function fallbackSummary(action: ProviderAccountAction): string {
  switch (action) {
    case "save":
      return t("Could not save this account.");
    case "signIn":
      return t("Could not complete sign-in.");
    case "remove":
      return t("Could not remove this account.");
    case "makeDefault":
      return t("Could not set the default account.");
  }
}

function loginSummary(error: HarnessLoginError): string {
  const provider = HARNESS_TITLE[error.harness];
  switch (error.code) {
    case "unsupported":
      return t("{p0} does not offer a single browser sign-in.", { p0: provider });
    case "stopFailed":
      return t("Could not stop sign-in. Please try again.");
    case "timedOut":
      return t("{p0} sign-in timed out. Please try again.", { p0: provider });
    case "spawnFailed":
      return t("Could not start {p0} sign-in.", { p0: provider });
    case "exited":
      return t("{p0} sign-in did not finish.", { p0: provider });
  }
}

function accountSummary(error: ProviderAccountError, action: ProviderAccountAction) {
  switch (error.code) {
    case "identityUnverified":
      return { summary: t("Could not verify the signed-in account. Please try again.") };
    case "duplicate":
      return { summary: t("This account is already added as “{p0}”.", { p0: error.label ?? "" }) };
    case "registrationInProgress":
      return { summary: t("An account sign-in is already in progress for this provider.") };
    case "accountMissing":
      return { summary: t("This account no longer exists.") };
    case "signInUnverified":
      return {
        summary: t("{p0} sign-in could not be verified.", {
          p0: error.harness ? HARNESS_TITLE[error.harness] : "",
        }),
        ...(error.detail ? { detail: error.detail } : {}),
      };
    case "cleanupFailed": {
      // The original failure stays visible; the repair step is added after it.
      const inner = presentProviderAccountError(error.cause, action);
      return {
        summary: t("{p0} Temporary profile cleanup failed; retry before adding another account.", {
          p0: inner.summary,
        }),
        ...(inner.detail ? { detail: inner.detail } : {}),
      };
    }
  }
}

/**
 * The text a screen shows for a failed provider account operation, in the current language.
 * Known codes get a translated sentence; anything else gets the translated `action` sentence
 * with the raw text kept only as redacted, bounded `detail`.
 */
export function presentProviderAccountError(
  error: unknown,
  action: ProviderAccountAction,
): ProviderAccountErrorPresentation {
  if (error instanceof ProviderAccountError) return accountSummary(error, action);
  if (error instanceof HarnessLoginError) {
    const detail = safeProviderAccountDetail(error.detail);
    return { summary: loginSummary(error), ...(detail ? { detail } : {}) };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return { summary: t("Sign-in cancelled.") };
  }
  const detail = safeProviderAccountDetail(error);
  return { summary: fallbackSummary(action), ...(detail ? { detail } : {}) };
}

/** One line for surfaces that hold a single string. */
export function providerAccountErrorText(error: unknown, action: ProviderAccountAction): string {
  const { summary, detail } = presentProviderAccountError(error, action);
  return detail ? `${summary} ${detail}` : summary;
}
