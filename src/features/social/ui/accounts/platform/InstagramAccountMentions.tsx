import { useState } from "react";
import { openExternal } from "../../../../../platform/tauri/openExternal";
import { formatDate, t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { Text } from "../../../../../shared/ui/Text";
import type { SocialClient } from "../../../model/socialClient";
import type { InstagramBrowserMentions } from "../../../model/socialBrowser";
import { useAccountWrite } from "../useAccountWrite";
import { InstagramRow, InstagramRows } from "./InstagramRows";
import "./instagram.css";

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
  const { write, is, error, details } = useAccountWrite(t("Could not read Instagram mentions."));
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
  const loaded = page ?? browserPage;
  return (
    <FieldGroup legend={t("Instagram mentions")} hideLegend disabled={disabled}>
      <div className="instagram-head">
        <Text size="caption" tone="secondary">
          {browser
            ? t("Only mentions visible in Instagram notifications are included.")
            : t("Only mentions received by this Host are included.")}
        </Text>
        <Button
          variant="secondary"
          size="sm"
          loading={is("read") && !page?.next}
          onClick={() => read()}
        >
          {loaded ? t("Refresh") : t("Read Instagram mentions")}
        </Button>
      </div>
      {is("read") && !loaded ? <LoadingText /> : null}
      {page?.mentions.length ? (
        <InstagramRows>
          {page.mentions.map((mention) => (
            <InstagramRow
              key={mention.commentId ?? mention.mediaId}
              title={mention.commentId ? t("Mention in a comment") : t("Mention in a post")}
              meta={formatDate(mention.at)}
            />
          ))}
        </InstagramRows>
      ) : null}
      {browserPage?.mentions.length ? (
        <InstagramRows>
          {browserPage.mentions.map((mention) => (
            <InstagramRow
              key={`${mention.url}:${mention.username}:${mention.text}`}
              title={mention.username ? `@${mention.username}` : t("Mention")}
              meta={mention.at ? formatDate(mention.at) : undefined}
              body={mention.text}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void write("open", () => openExternal(mention.url)).catch(() => undefined);
                }}
              >
                {t("Open on Instagram")}
              </Button>
            </InstagramRow>
          ))}
        </InstagramRows>
      ) : null}
      {loaded?.mentions.length === 0 ? (
        <EmptyState size="inline" context="list" title={t("No Instagram mentions found.")} />
      ) : null}
      {page?.next ? (
        <Button variant="ghost" size="sm" loading={is("read")} onClick={() => read(page.next)}>
          {t("Load more")}
        </Button>
      ) : null}
      {error ? <InlineError details={details}>{error}</InlineError> : null}
    </FieldGroup>
  );
}
