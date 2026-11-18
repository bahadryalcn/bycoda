import { useState, type FormEvent } from "react";
import {
  LINKEDIN_LIVE_EVENT_ID,
  type LinkedInLiveCommentsPage,
} from "../../../../integrations/social/live-linkedin";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Text } from "../../../../shared/ui/Text";
import { TextField } from "../../../../shared/ui/TextField";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "../accounts/useAccountWrite";

export function LinkedInLiveComments({
  accountId,
  client,
  disabled,
}: {
  accountId: string;
  client: SocialClient;
  disabled: boolean;
}) {
  const [eventId, setEventId] = useState("");
  const [page, setPage] = useState<LinkedInLiveCommentsPage>();
  const { error, is, write } = useAccountWrite(t("Could not load LinkedIn Live comments."));
  const load = (offset = 0) =>
    write("comments", async () => {
      setPage(
        await client.request<LinkedInLiveCommentsPage>("linkedin.live.comments.read", {
          accountId,
          eventId,
          offset,
        }),
      );
    });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!disabled && !is("comments") && LINKEDIN_LIVE_EVENT_ID.test(eventId))
      void load().catch(() => undefined);
  };
  return (
    <>
      <form onSubmit={submit}>
        <FieldGroup legend={t("LinkedIn Live comments")} disabled={disabled || is("comments")}>
          <TextField
            label={t("LinkedIn event ID")}
            inputMode="numeric"
            required
            maxLength={25}
            value={eventId}
            onChange={(event) => {
              setEventId(event.target.value.trim());
              setPage(undefined);
            }}
          />
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            loading={is("comments")}
            disabled={!LINKEDIN_LIVE_EVENT_ID.test(eventId)}
          >
            {t("Load comments")}
          </Button>
        </FieldGroup>
      </form>
      {error ? <InlineError>{error}</InlineError> : null}
      {page?.comments.length ? (
        <ul>
          {page.comments.map((comment) => (
            <li key={comment.id}>
              <Text as="p" size="caption" tone="muted">
                {comment.actor}
              </Text>
              <Text as="p">{comment.text}</Text>
            </li>
          ))}
        </ul>
      ) : page ? (
        <Text as="p">{t("No results")}</Text>
      ) : null}
      {page?.nextOffset !== undefined ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || is("comments")}
          onClick={() => void load(page.nextOffset).catch(() => undefined)}
        >
          {t("Next")}
        </Button>
      ) : null}
    </>
  );
}
