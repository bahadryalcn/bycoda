/** Owner-assisted signup: which platforms offer it, the non-secret fields and how a workflow reads. */
import { t } from "../../../../shared/i18n";
import type { BadgeTone } from "../../../../shared/ui/Badge";
import type { SocialPlatform } from "../../model/social";
import {
  SOCIAL_BROWSER_SITES,
  type SocialBrowserState,
  type SocialBrowserWorkflow,
  type SocialRegistrationBlocker,
  type SocialRegistrationField,
  type SocialRegistrationProfile,
} from "../../model/socialBrowser";
import type { ConnectionMethod } from "./connectOptions";

/** Platforms whose registration contract the Host implements (host/social/social-browser-registration.ts). */
const HOST_SIGNUP_PLATFORMS: readonly SocialPlatform[] = [
  "linkedin",
  "tiktok",
  "instagram",
  "facebook",
  "youtube",
  "reddit",
  "x",
];

/** Signup is offered for browser accounts of a platform with a signup route the Host can drive. */
export function canCreateAccount(platform: SocialPlatform, method: ConnectionMethod): boolean {
  return (
    method === "browser" &&
    HOST_SIGNUP_PLATFORMS.includes(platform) &&
    Boolean(SOCIAL_BROWSER_SITES[platform].routes.signup)
  );
}

/** Pages, channels and organizations are brand registrations; the Host never creates those generically. */
export function registrationAccountKind(accountType: string): "brand" | "person" {
  return ["page", "channel", "organization"].includes(accountType) ? "brand" : "person";
}

export const SIGNUP_FIELD_ORDER: readonly SocialRegistrationField[] = [
  "email",
  "givenName",
  "familyName",
  "displayName",
  "username",
  "birthdate",
  "category",
  "bio",
];

export function registrationFieldLabel(field: SocialRegistrationField): string {
  switch (field) {
    case "email":
      return t("Email address");
    case "givenName":
      return t("First name");
    case "familyName":
      return t("Last name");
    case "displayName":
      return t("Display name");
    case "username":
      return t("Username");
    case "birthdate":
      return t("Birth date");
    case "category":
      return t("Category");
    case "bio":
      return t("About");
  }
}

/** Mirrors the Host's parser so the owner sees the problem before the request; the Host stays the authority. */
export function registrationFieldProblem(
  field: SocialRegistrationField,
  value: string,
): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))
    return t("Enter a valid email address.");
  if (field === "username" && !/^[A-Za-z0-9._-]{2,64}$/.test(text))
    return t("Use 2 to 64 letters, digits, dots, dashes or underscores, without @.");
  return undefined;
}

/** The profile to send: the account kind plus only the entered, valid, non-secret fields. */
export function registrationProfile(
  accountType: string,
  draft: Partial<Record<SocialRegistrationField, string>>,
): SocialRegistrationProfile {
  const profile: SocialRegistrationProfile = { accountKind: registrationAccountKind(accountType) };
  for (const field of SIGNUP_FIELD_ORDER) {
    const value = draft[field]?.trim();
    if (value && !registrationFieldProblem(field, value)) profile[field] = value;
  }
  return profile;
}

/** The fields still to enter, in display order. */
export function missingFields(
  required: readonly SocialRegistrationField[],
  draft: Partial<Record<SocialRegistrationField, string>>,
): SocialRegistrationField[] {
  return SIGNUP_FIELD_ORDER.filter(
    (field) =>
      required.includes(field) &&
      (!draft[field]?.trim() || registrationFieldProblem(field, draft[field] ?? "")),
  );
}

/** The newest signup workflow of an account, from the Host's status snapshot. */
export function latestSignup(
  state: SocialBrowserState,
  accountId: string,
): SocialBrowserWorkflow | undefined {
  return state.workflows
    .filter((item) => item.accountId === accountId && item.intent === "signup")
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

/** Workflows the Host still drives: polling continues while one of these is current. */
export function isSignupLive(workflow: SocialBrowserWorkflow | undefined): boolean {
  return workflow?.status === "queued" || workflow?.status === "awaiting_owner";
}

export function blockerLabel(blocker: SocialRegistrationBlocker): string {
  switch (blocker) {
    case "password":
      return t("Choose a password");
    case "verification":
      return t("Enter the verification code");
    case "terms":
      return t("Accept the terms");
    case "challenge":
      return t("Solve the security check");
  }
}

export function signupStatus(workflow: SocialBrowserWorkflow): { label: string; tone: BadgeTone } {
  switch (workflow.status) {
    case "queued":
      return { label: t("Opening the window"), tone: "neutral" };
    case "awaiting_owner":
      return { label: t("Waiting for you"), tone: "info" };
    case "window_closed":
      return { label: t("Window closed"), tone: "neutral" };
    case "cancelled":
      return { label: t("Cancelled"), tone: "neutral" };
    case "expired":
      return { label: t("Expired"), tone: "warning" };
    case "interrupted":
      return { label: t("Interrupted"), tone: "warning" };
    case "failed":
      return { label: t("Failed"), tone: "danger" };
  }
}

export function signupStepLabel(step: NonNullable<SocialBrowserWorkflow["registration"]>["step"]) {
  switch (step) {
    case "method":
      return t("Choosing how to sign up");
    case "profile":
      return t("Profile details");
    case "birthdate":
      return t("Birth date");
    case "password":
    case "verification":
    case "terms":
    case "challenge":
      return blockerLabel(step);
    case "admin_setup":
      return t("Administrator setup");
    case "unknown":
      return t("Unrecognized step");
  }
}

/** A short problem for states the owner cannot advance from; undefined while work can go on. */
export function signupProblem(workflow: SocialBrowserWorkflow): string | undefined {
  if (workflow.status === "expired") return t("The signup window expired. Start again.");
  if (workflow.status === "interrupted")
    return t("The signup was interrupted. Start again to reopen the window.");
  if (workflow.status === "failed") return workflow.error || t("The signup could not continue.");
  const registration = workflow.registration;
  if (registration?.status === "unsupported")
    return t("This signup step is not recognized. Finish it in the platform window.");
  if (registration?.status === "changed")
    return t("The page changed. Review it in the platform window.");
  return undefined;
}
