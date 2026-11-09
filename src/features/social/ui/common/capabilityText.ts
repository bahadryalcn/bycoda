import { t } from "../../../../shared/i18n";
import type { Capability, SocialOperation } from "../../model/social";

type CapabilityRow = Pick<Capability, "status" | "reasonCode">;

/** Plain-language name of an operation. Raw operation keys are never shown. */
export function operationText(operation: SocialOperation): string {
  switch (operation) {
    case "publish":
      return t("Publishing");
    case "media":
      return t("Photos and video");
    case "comments.read":
      return t("Reading comments");
    case "reply":
      return t("Replies");
    case "comment":
      return t("Comments");
    case "inbox.read":
      return t("Inbox");
    case "message.reply":
      return t("Replying to messages");
    case "message.start":
      return t("Direct messages");
    case "search":
      return t("Search");
    case "webhook":
      return t("Live updates");
    case "poll":
      return t("Checking for new activity");
    case "delete":
      return t("Deleting posts");
    case "analytics":
      return t("Analytics");
    case "audience.collect":
      return t("Audience collection");
    case "profile.read":
      return t("Profile reading");
  }
}

/** True when the fix is a connection the owner can make from this screen. */
export function needsConnection(row: CapabilityRow): boolean {
  return (
    row.status === "expired" ||
    row.reasonCode === "browser.reconnect" ||
    row.reasonCode === "browser.session_expired" ||
    row.reasonCode === "api.token_expired" ||
    row.reasonCode.endsWith(".api_required")
  );
}

/**
 * Plain reason for a capability row. Known reason codes map to fixed copy; an unknown code falls
 * back to the status so a new host code never shows raw text.
 */
export function capabilityReasonText(row: CapabilityRow): string {
  const code = row.reasonCode;
  if (code === "api.ready" || code === "browser.ready") return t("Ready");
  if (needsConnection(row)) return t("Connection needed");
  if (code === "unsupported.platform") return t("Not available on this platform");
  if (code === "unsupported.not_yet") return t("Not available yet");
  if (code === "browser.no_recipe") return t("Not available in the browser yet");
  if (code === "api.account_type_unsupported") return t("Not available for this account type");
  if (code.endsWith(".webhook.external_setup")) return t("Finish setup on the platform");
  switch (row.status) {
    case "available":
      return t("Ready");
    case "pending":
      return t("Checking…");
    case "expired":
      return t("Connection needed");
    case "unsupported":
      return t("Not available yet");
  }
}
