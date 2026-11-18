import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { openExternal } from "../../../../../platform/tauri/openExternal";
import { Button } from "../../../../../shared/ui/Button";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { PasswordField } from "../../../../../shared/ui/PasswordField";
import { SectionLabel } from "../../../../../shared/ui/SectionLabel";
import { Select } from "../../../../../shared/ui/Select";
import { TextField } from "../../../../../shared/ui/TextField";
import { Text } from "../../../../../shared/ui/Text";
import { isXResourceId } from "../../../../../integrations/social/adapters/x-identifiers";
import { xHandoff, type XDestination } from "../../../../../integrations/social/x-handoff";
import type { SocialAccount } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import { XApiActions } from "./XApiActions";
import "./x.css";

type Props = { account: SocialAccount; client: SocialClient; disabled: boolean };

/** Every X page the owner finishes in the browser, each with one line on what happens there. */
function destinations(): { value: XDestination; label: string; hint: string }[] {
  return [
    {
      value: "connect",
      label: t("Connect account"),
      hint: t("Sign in to X in your browser, then connect the account here."),
    },
    {
      value: "signup",
      label: t("Create account"),
      hint: t("Create the account on X. X asks you to verify yourself, so you do it there."),
    },
    {
      value: "profile",
      label: t("Edit profile"),
      hint: t("Change your name, bio and photos on X."),
    },
    { value: "publish", label: t("Publishing"), hint: t("Write and publish a post on X.") },
    { value: "post", label: t("Open post"), hint: t("Open one post on X.") },
    {
      value: "messages",
      label: t("Direct messages"),
      hint: t("Read and answer direct messages on X."),
    },
    {
      value: "audience",
      label: t("Audience"),
      hint: t("See your followers and audience settings on X."),
    },
    { value: "lists", label: t("X lists"), hint: t("Create and manage lists on X.") },
    {
      value: "analytics",
      label: t("Analytics"),
      hint: t("See post analytics in X's creator studio."),
    },
    {
      value: "earnings",
      label: t("Creator earnings"),
      hint: t("See creator earnings in X's creator studio."),
    },
    {
      value: "live",
      label: "X Live Studio",
      hint: t("Start a live broadcast in X Live Studio, then save its stream details here."),
    },
    { value: "spaces", label: t("Spaces"), hint: t("Read X's help page about Spaces.") },
  ];
}

export function XAccountActions({ account, client, disabled }: Props) {
  const [destination, setDestination] = useState<XDestination>("profile");
  const [target, setTarget] = useState("");
  const [streamServer, setStreamServer] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const { error, is, write } = useAccountWrite(t("Could not open the link."));
  const needsTarget = destination === "post";
  const options = destinations();
  const current = options.find((option) => option.value === destination);
  return (
    <Disclosure summary={t("X actions")} variant="row">
      <div className="social-x-stack">
        <div className="social-x-group">
          <SectionLabel variant="inline" size="secondary" as="h4">
            {t("Finish on X")}
          </SectionLabel>
          <Text as="p" size="secondary" tone="muted">
            {t(
              "X does not let apps do these steps. MonoCode opens the exact page and you finish it there.",
            )}
          </Text>
          <Select
            label={t("What do you want to do on X?")}
            value={destination}
            options={options.map(({ value, label }) => ({ value, label }))}
            onValueChange={(value) => {
              setDestination(value as XDestination);
              setStreamServer("");
              setStreamKey("");
              setKeySaved(false);
            }}
          />
          {current ? (
            <Text as="p" size="secondary">
              {current.hint}
            </Text>
          ) : null}
          {needsTarget ? (
            <TextField
              label={t("Post ID")}
              description={t("The number at the end of the post's link on x.com.")}
              inputMode="numeric"
              value={target}
              onChange={(event) => setTarget(event.currentTarget.value)}
            />
          ) : null}
          <Button
            variant="primary"
            size="sm"
            className="self-start"
            loading={is("open")}
            disabled={needsTarget && !isXResourceId(target)}
            onClick={() =>
              void write("open", () =>
                openExternal(
                  xHandoff(destination, needsTarget ? target : undefined, account.platformId).url,
                ),
              )
            }
          >
            {t("Open in browser")}
          </Button>
          {error ? <InlineError>{error}</InlineError> : null}
        </div>
        {destination === "live" && account.connected ? (
          <div className="social-x-group">
            <SectionLabel variant="inline" size="secondary" as="h4">
              {t("Stream details")}
            </SectionLabel>
            <TextField
              label={t("Stream server")}
              description={t(
                "Copy the server and key from X Live Studio. If you saved only a key before, save both again for Live games.",
              )}
              value={streamServer}
              placeholder="rtmps://"
              autoComplete="off"
              disabled={disabled || is("key")}
              onChange={(event) => {
                setStreamServer(event.currentTarget.value);
                setKeySaved(false);
              }}
            />
            <PasswordField
              label={t("X stream key")}
              value={streamKey}
              autoComplete="off"
              disabled={disabled || is("key")}
              onChange={(event) => {
                setStreamKey(event.currentTarget.value);
                setKeySaved(false);
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              disabled={disabled || !streamServer.trim() || !streamKey.trim()}
              loading={is("key")}
              onClick={() =>
                void write("key", async () => {
                  await client.saveXLiveKey(account.id, streamKey.trim(), streamServer.trim());
                  setStreamServer("");
                  setStreamKey("");
                  setKeySaved(true);
                })
              }
            >
              {t("Save stream credentials")}
            </Button>
            {keySaved ? (
              <InlineMessage tone="success">{t("Stream key saved")}</InlineMessage>
            ) : null}
          </div>
        ) : null}
        {account.connected && account.xApiProduct ? (
          <XApiActions account={account} client={client} disabled={disabled || account.paused} />
        ) : null}
      </div>
    </Disclosure>
  );
}
