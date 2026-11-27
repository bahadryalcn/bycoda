import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Text } from "../../../../shared/ui/Text";
import { Select } from "../../../../shared/ui/Select";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import type { SocialClient } from "../../model/socialClient";
import type { SocialChromeTab } from "../../model/socialBrowser";
import { useAccountWrite } from "./useAccountWrite";

function tabLabel(tab: SocialChromeTab): string {
  return tab.title ? `${tab.title} (${tab.site})` : tab.site;
}

/** Explicit owner consent and tab selection for the ordinary, already signed-in Chrome profile. */
export function ChromeSessionConnect({
  client,
  accountId,
  resourceId,
  disabled,
  disabledReason,
  onChanged,
}: {
  client: SocialClient;
  accountId: string;
  resourceId?: string;
  disabled: boolean;
  /** Why `disabled` is on; shown on each blocked control. */
  disabledReason: string;
  onChanged(): void;
}) {
  const [allowed, setAllowed] = useState(false);
  const [tabs, setTabs] = useState<SocialChromeTab[]>();
  const [selected, setSelected] = useState("");
  const [connected, setConnected] = useState(false);
  const { failureTitle, details, is, write } = useAccountWrite(
    t("Could not connect to Chrome. Try again."),
  );
  const busy = is("chrome:tabs") || is("chrome:connect");
  const waiting = t("Wait for the Chrome request to finish.");
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
        <div className="social-card-head">
          <Checkbox
            label={t("Allow access to my Chrome profile")}
            description={t(
              "Chrome debugging permission can expose other tabs and profile data. Bycoda uses this connection for the selected social account.",
            )}
            checked={allowed}
            disabled={disabled || busy}
            disabledReason={disabled ? disabledReason : waiting}
            onChange={(event) => {
              setAllowed(event.target.checked);
              setTabs(undefined);
              setSelected("");
              setConnected(false);
            }}
          />
          <InfoPopover width={360}>
            <p>
              {t(
                "Use accounts already signed in to Chrome on this computer. Saved passwords are not imported.",
              )}
            </p>
            <p>
              {t(
                "In Chrome 144 or newer, open chrome://inspect/#remote-debugging, enable remote debugging, and approve Chrome's connection dialog.",
              )}
            </p>
          </InfoPopover>
        </div>
        <div className="social-field-row">
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || !allowed || busy}
            disabledReason={
              disabled
                ? disabledReason
                : !allowed
                  ? t("Allow access to your Chrome profile first.")
                  : waiting
            }
            loading={is("chrome:tabs")}
            onClick={find}
          >
            {t("Find Chrome tabs")}
          </Button>
          {tabs?.length === 1 ? (
            <Text as="span" size="caption" tone="muted" truncate>
              {tabLabel(tabs[0]!)}
            </Text>
          ) : null}
          {tabs && tabs.length > 1 ? (
            <Select
              label={t("Chrome tab")}
              value={selected}
              disabled={disabled || busy}
              options={tabs.map((tab) => ({
                value: tab.id,
                label: tabLabel(tab),
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
              disabledReason={
                disabled
                  ? disabledReason
                  : !allowed
                    ? t("Allow access to your Chrome profile first.")
                    : busy
                      ? waiting
                      : t("Choose a Chrome tab first.")
              }
              loading={is("chrome:connect")}
              onClick={connect}
            >
              {t("Connect selected Chrome account")}
            </Button>
          ) : null}
        </div>
        {tabs?.length === 0 ? (
          <InlineMessage tone="warning" live="off">
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
        {failureTitle ? <InlineError details={details}>{failureTitle}</InlineError> : null}
      </div>
    </Disclosure>
  );
}
