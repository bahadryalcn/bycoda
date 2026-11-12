import { InlineError } from "../../../../../shared/ui/InlineError";
import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { useEffect, useRef, useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";

import { Text } from "../../../../../shared/ui/Text";
import { TextField } from "../../../../../shared/ui/TextField";
import type { SocialAccount, SocialTelegramChannelReview } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";

export type TelegramChannelConnectProps = {
  client: SocialClient;
  account: SocialAccount;
  disabled: boolean;
  onRefresh(): void;
};

/**
 * Connects a Telegram channel in two steps: inspect the channel and bot, then connect exactly the
 * reviewed channel. The review expires; a connect after expiry is refused here and by the Host.
 * No token is typed here. The Host holds the bot credential.
 */
export function TelegramChannelConnect({
  client,
  account,
  disabled,
  onRefresh,
}: TelegramChannelConnectProps) {
  const [target, setTarget] = useState(account.connected ? account.platformId : "");
  const [review, setReview] = useState<SocialTelegramChannelReview>();
  const [pending, setPending] = useState<"inspect" | "connect">();
  const [error, setError] = useState("");
  const occupied = useRef(false);
  const generation = useRef(0);

  // Another account (or a changed connection) starts from its own state; late results are dropped.
  const accountKey = `${account.id}|${account.connected}|${account.platformId}`;
  const [seenKey, setSeenKey] = useState(accountKey);
  if (seenKey !== accountKey) {
    setSeenKey(accountKey);
    setReview(undefined);
    setError("");
    setTarget(account.connected ? account.platformId : "");
  }
  useEffect(() => {
    generation.current++;
  }, [accountKey]);

  // A view that unmounts (for example when the owner switches account) never publishes a late result.
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (!review) return;
    const timer = setTimeout(
      () => {
        setReview(undefined);
        setError(t("The channel review expired. Inspect it again before connecting."));
      },
      Math.max(0, review.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [review]);

  const busy = !!pending || disabled;
  const run = async (kind: "inspect" | "connect", action: () => Promise<void>) => {
    if (busy || occupied.current) return;
    occupied.current = true;
    setPending(kind);
    setError("");
    try {
      await action();
    } catch {
      setError(
        t(
          "The channel could not be verified. Check the bot's channel administrator rights and inspect it again.",
        ),
      );
    } finally {
      occupied.current = false;
      setPending(undefined);
    }
  };

  const inspect = () =>
    void run("inspect", async () => {
      const requested = generation.current;
      setReview(undefined);
      const observed = await client.tokenInspect(account.id, target.trim());
      if (generation.current === requested) setReview(observed);
    }).catch(() => undefined);

  const connect = () =>
    void run("connect", async () => {
      if (!review || Date.now() >= review.expiresAt) {
        setReview(undefined);
        setError(t("The channel review expired. Inspect it again before connecting."));
        return;
      }
      const approved = review;
      setReview(undefined);
      await client.tokenConnect(account.id, approved.reviewId);
      onRefresh();
    }).catch(() => undefined);

  return (
    <div {...surfaceAttributes({ frame: "settings", edge: "block-start" }, "social-card")}>
      <Text as="p" tone="muted" leading="snug" className="social-muted">
        {t(
          "Create the Telegram channel with your existing account and add the configured bot as an administrator with permission to post. Connecting here does not change those permissions.",
        )}
      </Text>
      <TextField
        label={t("Telegram channel ID or public username")}
        value={target}
        maxLength={100}
        disabled={busy}
        placeholder="@bycoda"
        onChange={(event) => {
          generation.current++;
          setTarget(event.currentTarget.value);
          setReview(undefined);
          setError("");
        }}
      />
      <Button
        variant="secondary"
        size="sm"
        loading={pending === "inspect"}
        disabled={busy || !target.trim()}
        onClick={inspect}
      >
        {t("Inspect channel and bot")}
      </Button>
      {review ? (
        <div>
          <p>
            {t("Channel")}: {review.channelName} ({review.channelId})
          </p>
          <p>
            {t("Bot")}: {review.botName} ({review.botId})
          </p>
          <Text as="p" tone="muted" leading="snug" className="social-muted">
            {t(
              "This connection publishes to the reviewed channel. Private messages and channel monitoring stay separate.",
            )}
          </Text>
          <Button
            variant="primary"
            size="sm"
            loading={pending === "connect"}
            disabled={busy}
            onClick={connect}
          >
            {account.connected ? t("Reconnect reviewed channel") : t("Connect reviewed channel")}
          </Button>
        </div>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}
