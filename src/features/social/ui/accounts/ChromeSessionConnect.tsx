import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Select } from "../../../../shared/ui/Select";
import { Text } from "../../../../shared/ui/Text";
import type { SocialClient } from "../../model/socialClient";
import type { SocialChromeTab } from "../../model/socialBrowser";
import { useAccountWrite } from "./useAccountWrite";

/** Explicit owner consent and tab selection for the ordinary, already signed-in Chrome profile. */
export function ChromeSessionConnect({
  client,
  accountId,
  resourceId,
  disabled,
  onChanged,
}: {
  client: SocialClient;
  accountId: string;
  resourceId?: string;
  disabled: boolean;
  onChanged(): void;
}) {
  const [allowed, setAllowed] = useState(false);
  const [tabs, setTabs] = useState<SocialChromeTab[]>();
  const [selected, setSelected] = useState("");
  const [connected, setConnected] = useState(false);
  const { error, is, write } = useAccountWrite(t("Could not connect to Chrome. Try again."));
  const busy = is("chrome:tabs") || is("chrome:connect");
  const find = () =>
    void write("chrome:tabs", async () => {
      setConnected(false);
      setTabs(undefined);
      setSelected("");
      const result = await client.browserChromeTabs(accountId, allowed);
      setTabs(result.tabs);
      setSelected(result.tabs[0]?.id ?? "");
    }).catch(() => undefined);
  const connect = () =>
    void write("chrome:connect", async () => {
      setConnected(false);
      const result = await client.browserChromeConnect(accountId, selected, allowed, resourceId);
      if (result.status === "connected") {
        setConnected(true);
        onChanged();
      }
    }).catch(() => undefined);
  return (
    <Disclosure summary={t("Use existing Chrome session")} variant="row" size="sm">
      <div className="social-card">
        <Text as="p" tone="muted">
          {t(
            "Use accounts already signed in to Chrome on this computer. Saved passwords are not imported.",
          )}
        </Text>
        <Text as="p" tone="muted">
          {t(
            "In Chrome 144 or newer, open chrome://inspect/#remote-debugging, enable remote debugging, and approve Chrome's connection dialog.",
          )}
        </Text>
        <Checkbox
          label={t("Allow access to my Chrome profile")}
          description={t(
            "Chrome debugging permission can expose other tabs and profile data. Bycoda uses this connection for the selected social account.",
          )}
          checked={allowed}
          disabled={disabled || busy}
          onChange={(event) => {
            setAllowed(event.target.checked);
            setTabs(undefined);
            setSelected("");
            setConnected(false);
          }}
        />
        <div className="social-field-row">
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || !allowed || busy}
            loading={is("chrome:tabs")}
            onClick={find}
          >
            {t("Find Chrome tabs")}
          </Button>
          {tabs?.length ? (
            <Select
              label={t("Chrome tab")}
              value={selected}
              disabled={disabled || busy}
              options={tabs.map((tab) => ({
                value: tab.id,
                label: tab.title ? `${tab.title} (${tab.site})` : tab.site,
              }))}
              onValueChange={(value) => {
                setSelected(value);
                setConnected(false);
              }}
            />
          ) : null}
          {tabs?.length ? (
            <Button
              variant="primary"
              size="sm"
              disabled={disabled || !allowed || !selected || busy}
              loading={is("chrome:connect")}
              onClick={connect}
            >
              {t("Connect selected Chrome account")}
            </Button>
          ) : null}
        </div>
        {tabs?.length === 0 ? (
          <InlineMessage tone="info">
            {t(
              "No matching platform tabs found. Open the social platform in Chrome, then try again.",
            )}
          </InlineMessage>
        ) : null}
        {connected ? (
          <InlineMessage tone="success">
            {t(
              "Chrome account identity verified. This account now uses the existing Chrome session.",
            )}
          </InlineMessage>
        ) : null}
        {error ? <InlineError>{error}</InlineError> : null}
      </div>
    </Disclosure>
  );
}
