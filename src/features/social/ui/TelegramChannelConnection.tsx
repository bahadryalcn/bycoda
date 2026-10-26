import { useContext, useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { t, useLocale } from "../../../shared/i18n";
import type { SocialAccount, SocialTelegramChannelReview } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { SocialBusyContext } from "./socialContext";

export function TelegramChannelConnection({
  account,
  client,
  disabled,
  onRefresh,
}: {
  account: SocialAccount;
  client: SocialClient;
  disabled?: boolean;
  onRefresh: () => Promise<unknown>;
}) {
  useLocale();
  const locked = useContext(SocialBusyContext);
  const [target, setTarget] = useState(account.connected ? account.platformId : "");
  const [review, setReview] = useState<SocialTelegramChannelReview>();
  const [pending, setPending] = useState<"inspect" | "connect">();
  const [error, setError] = useState("");
  const occupied = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setReview(undefined);
    setTarget(account.connected ? account.platformId : "");
    setError("");
  }, [
    account.id,
    account.executorId,
    account.platformId,
    account.connected,
    account.telegramBotId,
    client,
  ]);
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
  const busy = !!pending || disabled || locked;
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
  return (
    <div>
      <p>
        {t(
          "Create the Telegram channel with your existing account and add the configured bot as an administrator with permission to post. Connecting here does not change those permissions.",
        )}
      </p>
      <TextField
        label={t("Telegram channel ID or public username")}
        value={target}
        maxLength={100}
        disabled={busy}
        placeholder="@bycoda"
        onChange={(event) => {
          generation.current++;
          setTarget(event.target.value);
          setReview(undefined);
          setError("");
        }}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={busy || !target.trim()}
        loading={pending === "inspect"}
        onClick={() =>
          void run("inspect", async () => {
            const requested = generation.current;
            setReview(undefined);
            const observed = await client.tokenInspect(account.id, target.trim());
            if (generation.current === requested) setReview(observed);
          })
        }
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
          <p>
            {t(
              "This connection publishes to the reviewed channel. Private messages and channel monitoring stay separate.",
            )}
          </p>
          <Button
            type="button"
            disabled={busy || Date.now() >= review.expiresAt}
            loading={pending === "connect"}
            onClick={() =>
              void run("connect", async () => {
                if (Date.now() >= review.expiresAt) {
                  setReview(undefined);
                  setError(t("The channel review expired. Inspect it again before connecting."));
                  return;
                }
                const approved = review;
                setReview(undefined);
                await client.tokenConnect(account.id, approved.reviewId);
                await onRefresh();
              })
            }
          >
            {account.connected ? t("Reconnect reviewed channel") : t("Connect reviewed channel")}
          </Button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
