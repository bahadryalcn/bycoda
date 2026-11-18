import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { openExternal } from "../../../../../platform/tauri/openExternal";
import { Button } from "../../../../../shared/ui/Button";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { Select } from "../../../../../shared/ui/Select";
import { TextField } from "../../../../../shared/ui/TextField";
import { Text } from "../../../../../shared/ui/Text";
import { isXResourceId } from "../../../../../integrations/social/adapters/x-identifiers";
import { xHandoff, type XDestination } from "../../../../../integrations/social/x-handoff";
import type { SocialAccount } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import { XApiActions } from "./XApiActions";

type Props = { account: SocialAccount; client: SocialClient; disabled: boolean };

export function XAccountActions({ account, client, disabled }: Props) {
  const [destination, setDestination] = useState<XDestination>("profile");
  const [target, setTarget] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const { error, is, write } = useAccountWrite(t("Could not open the link."));
  const needsTarget = destination === "post";
  return (
    <Disclosure summary={t("X actions")} variant="row">
      <div className="social-field-row">
        <Select
          label={t("Open in browser")}
          value={destination}
          options={[
            { value: "connect", label: t("Connect account") },
            { value: "signup", label: t("Create account") },
            { value: "profile", label: t("Edit profile") },
            { value: "publish", label: t("Publishing") },
            { value: "post", label: t("Open post") },
            { value: "messages", label: t("Direct messages") },
            { value: "audience", label: t("Audience") },
            { value: "lists", label: t("X lists") },
            { value: "analytics", label: t("Analytics") },
            { value: "earnings", label: t("Creator earnings") },
            { value: "live", label: "X Live Studio" },
            { value: "spaces", label: t("Spaces") },
          ]}
          onValueChange={(value) => setDestination(value as XDestination)}
        />
        {needsTarget ? (
          <TextField
            label={t("Post ID")}
            inputMode="numeric"
            value={target}
            onChange={(event) => setTarget(event.currentTarget.value)}
          />
        ) : null}
        <Button
          variant="link"
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
        {destination === "live" && account.connected ? (
          <>
            <TextField
              label={t("X stream key")}
              type="password"
              value={streamKey}
              autoComplete="off"
              onChange={(event) => {
                setStreamKey(event.currentTarget.value);
                setKeySaved(false);
              }}
            />
            <Button
              disabled={disabled || !streamKey.trim()}
              loading={is("key")}
              onClick={() =>
                void write("key", async () => {
                  await client.saveXLiveKey(account.id, streamKey);
                  setStreamKey("");
                  setKeySaved(true);
                })
              }
            >
              {t("Save stream key")}
            </Button>
            {keySaved ? (
              <Text as="p" size="caption">
                {t("Stream key saved")}
              </Text>
            ) : null}
          </>
        ) : null}
        {error ? <InlineError>{error}</InlineError> : null}
      </div>
      {account.connected && account.xApiProduct ? (
        <XApiActions account={account} client={client} disabled={disabled || account.paused} />
      ) : null}
    </Disclosure>
  );
}
