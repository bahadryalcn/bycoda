import { openExternal } from "../../../../../platform/tauri/openExternal";
import { t } from "../../../../../shared/i18n";
import { InlineMessage } from "../../../../../shared/ui/InlineError";
import type { SocialAccount, SocialOperation } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import { asYoutubeRecord } from "./YouTubeResult";

/** Where the owner finds the Google Cloud project's OAuth consent screen and its verification state. */
export const GOOGLE_CONSENT_URL = "https://console.cloud.google.com/apis/credentials/consent";

/** The operation whose OAuth scope a `needs_scope` result asks for, or undefined for any other result. */
export function youtubeScopeOperation(result: unknown): SocialOperation | undefined {
  const data = asYoutubeRecord(result);
  if (data?.status !== "needs_scope") return undefined;
  return data.reasonCode === "youtube_monetary_scope_required"
    ? "monetization.read"
    : "analytics.report";
}

/**
 * Owner handoff for a missing Analytics or earnings scope. Both scopes are Google "sensitive"
 * scopes: the owner approves them on Google's consent page, and a project whose consent screen is
 * not verified shows an unverified-app warning until it is.
 */
export function YouTubeScopeHandoff({
  client,
  account,
  operation,
  disabled,
}: {
  client: SocialClient;
  account: SocialAccount;
  operation: SocialOperation;
  disabled: boolean;
}) {
  const { write, error, is } = useAccountWrite(
    t("The connection could not be started. Try again."),
  );
  const reconnect = () =>
    write("youtube-scope", async () => {
      const begin = await client.oauthBegin(account.id, undefined, [operation]);
      await openExternal(begin.url);
    });
  const copy =
    operation === "monetization.read"
      ? t(
          "Estimated earnings need the YouTube Analytics monetary permission, a sensitive Google permission. Reconnect and approve it on Google's page. If Google shows an unverified-app warning, finish the OAuth consent screen and verification in your Google Cloud project first.",
        )
      : t(
          "YouTube Analytics reports need the Analytics permission, a sensitive Google permission. Reconnect and approve it on Google's page. If Google shows an unverified-app warning, finish the OAuth consent screen and verification in your Google Cloud project first.",
        );
  return (
    <InlineMessage
      tone="warning"
      action={{
        label: t("Reconnect with this permission"),
        pending: is("youtube-scope"),
        disabled,
        onClick: () => {
          reconnect().catch(() => undefined);
        },
      }}
      secondaryAction={{
        label: t("Open Google consent screen"),
        onClick: () => {
          openExternal(GOOGLE_CONSENT_URL).catch(() => undefined);
        },
      }}
    >
      {error ? `${copy} ${error}` : copy}
    </InlineMessage>
  );
}
