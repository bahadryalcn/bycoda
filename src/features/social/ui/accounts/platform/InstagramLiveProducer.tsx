import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { Text } from "../../../../../shared/ui/Text";
import type { InstagramLiveAction, InstagramLiveState } from "../../../model/instagramLive";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import "./instagram.css";

const ACTION_CONFIRMATION = {
  start: "START_INSTAGRAM_LIVE",
  end: "END_INSTAGRAM_LIVE",
  forget: "FORGET_INSTAGRAM_STREAM_CREDENTIALS",
} as const;

export function InstagramLiveProducer({
  client,
  accountId,
  disabled,
}: {
  client: SocialClient;
  accountId: string;
  disabled: boolean;
}) {
  const [live, setLive] = useState<InstagramLiveState>();
  const [notice, setNotice] = useState<string>();
  const { is, write, error, details } = useAccountWrite(
    t("Instagram could not complete this action."),
  );
  const confirmation = useConfirm();
  const run = (action: InstagramLiveAction, confirm?: string) => {
    setNotice(undefined);
    void write(action, async () => {
      const state = await client.browserInstagramLive(accountId, action, confirm);
      setLive(state);
      if (action === "capture" && state.credentialsStored)
        setNotice(t("Instagram stream credentials saved."));
      if (action === "forget" && !state.credentialsStored)
        setNotice(t("Instagram stream credentials removed."));
    }).catch(() => undefined);
  };
  const reviewed = (action: keyof typeof ACTION_CONFIRMATION, label: string) => {
    void confirmation
      .confirm({
        title: label,
        message: t("Apply this change on Instagram?"),
        confirmLabel: label,
        danger: action !== "start",
      })
      .then((ok) => {
        if (ok) run(action, ACTION_CONFIRMATION[action]);
      })
      .catch(() => undefined);
  };
  const status =
    live?.state === "live"
      ? t("Instagram is live.")
      : live?.state === "awaiting_stream"
        ? t("Instagram is awaiting a stream.")
        : live?.state === "unknown"
          ? t("Instagram Live result is uncertain. Check the producer window.")
          : live?.windowOpen
            ? t("Open Live video in the private browser window, then capture the credentials.")
            : live
              ? t("Instagram Live window is closed.")
              : undefined;
  return (
    <FieldGroup legend={t("Instagram LIVE")} hideLegend disabled={disabled}>
      <div className="instagram-actions">
        <Button
          variant="secondary"
          size="sm"
          loading={is("open")}
          disabled={live?.windowOpen}
          onClick={() => run("open")}
        >
          {t("Open Instagram Live Producer")}
        </Button>
        <Button variant="ghost" size="sm" loading={is("status")} onClick={() => run("status")}>
          {t("Read Instagram live status")}
        </Button>
      </div>
      <Text as="p" size="caption" tone="secondary">
        {status ?? t("Open the producer, capture the stream credentials, then go live.")}
      </Text>
      {live?.windowOpen ? (
        <div className="instagram-actions">
          <Button
            variant="secondary"
            size="sm"
            loading={is("capture")}
            disabled={live.state === "unknown"}
            onClick={() => run("capture")}
          >
            {t("Capture Instagram stream credentials")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={is("start")}
            disabled={!live.canStart}
            onClick={() => reviewed("start", t("Start Instagram live"))}
          >
            {t("Start Instagram live")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={is("end")}
            disabled={live.state !== "live"}
            onClick={() => reviewed("end", t("End Instagram live"))}
          >
            {t("End Instagram live")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={is("close")}
            disabled={live.state === "live" || live.state === "unknown"}
            onClick={() => run("close")}
          >
            {t("Close")}
          </Button>
        </div>
      ) : null}
      {live?.credentialsStored ? (
        <Button
          variant="ghost"
          size="sm"
          loading={is("forget")}
          onClick={() => reviewed("forget", t("Forget Instagram stream credentials"))}
        >
          {t("Forget Instagram stream credentials")}
        </Button>
      ) : null}
      {notice ? <InlineMessage tone="success">{notice}</InlineMessage> : null}
      {error ? <InlineError details={details}>{error}</InlineError> : null}
      {confirmation.dialog}
    </FieldGroup>
  );
}
