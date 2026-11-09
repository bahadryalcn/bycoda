import { t } from "../../../../shared/i18n";
import type { MessagingAccount } from "../../../messaging";
import type { SaveInputResult } from "./emailPresets";

/** Channel IDs separated by commas, spaces or new lines; order kept, duplicates dropped. */
export function parseChannelIds(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).filter(Boolean))];
}

/** Discord IDs are numeric snowflakes. */
export const invalidChannelIds = (ids: readonly string[]) =>
  ids.filter((id) => !/^\d{5,25}$/.test(id));

export function accountChannelIds(account?: MessagingAccount | null): string[] {
  const ids = account?.config.channelIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

export function slackSaveInput(token: string, id?: string): SaveInputResult {
  const botToken = token.trim();
  if (!botToken) return { ok: false, error: t("Enter the bot token.") };
  return {
    ok: true,
    input: { ...(id ? { id } : {}), provider: "slack", config: {}, secret: { botToken } },
  };
}

/** A finished browser sign-in replaces any stored bot token natively; no secret leaves the UI. */
export function slackSignInSaveInput(authHandle: string, id?: string): SaveInputResult {
  if (!authHandle) return { ok: false, error: t("Sign in with Slack first.") };
  return {
    ok: true,
    input: { ...(id ? { id } : {}), provider: "slack", config: {}, authHandle },
  };
}

/** An empty token on edit keeps the stored one. */
export function discordSaveInput(token: string, channelText: string, id?: string): SaveInputResult {
  const botToken = token.trim();
  if (!botToken && !id) return { ok: false, error: t("Enter the bot token.") };
  const channelIds = parseChannelIds(channelText);
  if (channelIds.length === 0) return { ok: false, error: t("Enter at least one channel ID.") };
  const invalid = invalidChannelIds(channelIds);
  if (invalid.length > 0)
    return {
      ok: false,
      error: t("Channel IDs are numbers. Check: {p0}", { p0: invalid.join(", ") }),
    };
  return {
    ok: true,
    input: {
      ...(id ? { id } : {}),
      provider: "discord",
      config: { channelIds },
      ...(botToken ? { secret: { botToken } } : {}),
    },
  };
}

/** Without a new sign-in an edit keeps the stored Microsoft tokens. */
export function teamsSaveInput(
  { tenant, clientId }: { tenant: string; clientId: string },
  { id, authHandle }: { id?: string; authHandle?: string },
): SaveInputResult {
  if (!id && !authHandle) return { ok: false, error: t("Sign in with Microsoft first.") };
  const trimmedClientId = clientId.trim();
  return {
    ok: true,
    input: {
      ...(id ? { id } : {}),
      provider: "teams",
      config: {
        tenant: tenant.trim() || "common",
        ...(trimmedClientId ? { clientId: trimmedClientId } : {}),
      },
      ...(authHandle ? { authHandle } : {}),
    },
  };
}
