import { useState } from "react";
import { openExternal } from "../../../../../platform/tauri/openExternal";
import { formatDate, t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { Text } from "../../../../../shared/ui/Text";
import type { SocialClient } from "../../../model/socialClient";
import type { InstagramBrowserMentions } from "../../../model/socialBrowser";
import { useAccountWrite } from "../useAccountWrite";

type Mention = { mediaId: string; commentId?: string; at: number };
type Page = { mentions: Mention[]; next?: string; coverage: "webhook_only" };

export function InstagramAccountMentions({
  client,
  accountId,
  browser,
  disabled,
}: {
  client: SocialClient;
  accountId: string;
  browser: boolean;
  disabled: boolean;
}) {
  const [page, setPage] = useState<Page>();
  const [browserPage, setBrowserPage] = useState<InstagramBrowserMentions>();
  const { write, is, error } = useAccountWrite(t("Could not read Instagram mentions."));
  const read = (cursor?: string) => {
    void write("read", async () => {
      if (browser) setBrowserPage(await client.browserInstagramMentions(accountId));
      else {
        const current = await client.request<Page>("instagram.mentions", {
          accountId,
          ...(cursor ? { cursor } : {}),
        });
        setPage((saved) =>
          cursor && saved
            ? { ...current, mentions: [...saved.mentions, ...current.mentions] }
            : current,
        );
      }
    }).catch(() => undefined);
  };
  return (
    <FieldGroup legend={t("Instagram mentions")} disabled={disabled}>
      <Text size="caption" tone="muted">
        {browser
          ? t("Only mentions visible in Instagram notifications are included.")
          : t("Only mentions received by this Host are included.")}
      </Text>
      <Button variant="secondary" size="sm" loading={is("read")} onClick={() => read()}>
        {t("Read Instagram mentions")}
      </Button>
      {page?.mentions.length ? (
        <ul>
          {page.mentions.map((mention) => (
            <Text key={mention.commentId ?? mention.mediaId} as="li" size="secondary">
              {formatDate(mention.at)} · {mention.commentId ?? mention.mediaId}
            </Text>
          ))}
        </ul>
      ) : null}
      {browserPage?.mentions.length ? (
        <ul>
          {browserPage.mentions.map((mention) => (
            <li key={`${mention.url}:${mention.username}:${mention.text}`}>
              <Button
                variant="link"
                onClick={() => {
                  void write("open", () => openExternal(mention.url)).catch(() => undefined);
                }}
              >
                {mention.text}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {(page ?? browserPage)?.mentions.length === 0 ? (
        <Text size="caption" tone="muted">
          {t("No Instagram mentions found.")}
        </Text>
      ) : null}
      {page?.next ? (
        <Button variant="ghost" size="sm" disabled={is("read")} onClick={() => read(page.next)}>
          {t("Load more")}
        </Button>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
    </FieldGroup>
  );
}
