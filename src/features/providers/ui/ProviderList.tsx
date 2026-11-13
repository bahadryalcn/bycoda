import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Button } from "../../../shared/ui/Button";
import { Check, Bot } from "../../../shared/ui/icons";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { HARNESS_TITLE, type HarnessId } from "../../sessions/model/session";
import { Toggle } from "../../settings/ui/settingsControls";
import type { ProviderAuthState, ProviderAuthTone } from "./providerStatus";
import { useGrokSignInState } from "./providerStatus";

/** Ink of the auth line: a warning for a sign-in or quota problem, danger when exhausted. */
function authMetaTone(tone: ProviderAuthTone | undefined) {
  if (tone === "exhausted") return "danger";
  if (tone === "signedOut" || tone === "low") return "warning";
  return "secondary";
}

/** Everything the list needs to draw one provider, resolved by the page. */
export type ProviderListEntry = {
  harness: HarnessId;
  /** The CLI was found on this machine. */
  available: boolean;
  isDefault: boolean;
  inPicker: boolean;
  /** Hidden for every project, so a project cannot turn it back on. */
  pickerLocked: boolean;
  /** Installed version, once a version check has run. */
  version?: string;
  updateAvailable: boolean;
  auth: ProviderAuthState | null;
  accountSummary?: string;
};

/** The one-line summary under a provider's name: version, sign-in and picker state. */
export function providerMetaLine(entry: ProviderListEntry, probed: boolean): string {
  if (!probed) return t("Checking CLI…");
  if (!entry.available) return entry.harness === "acp" ? t("Add provider") : t("Not installed");
  if (entry.accountSummary && (entry.auth?.tone === "low" || entry.auth?.tone === "exhausted")) {
    return `${entry.accountSummary}, ${entry.auth.label}`;
  }
  return entry.accountSummary ?? entry.auth?.label ?? "";
}

function ProviderListItem({
  entry,
  probed,
  selected,
  disabled,
  onSelect,
  onPickerVisible,
  onSetup,
}: {
  entry: ProviderListEntry;
  probed: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: (harness: HarnessId) => void;
  onPickerVisible: (harness: HarnessId, visible: boolean) => void;
  onSetup: (harness: HarnessId) => void;
}) {
  const { harness, available } = entry;
  const title = HARNESS_TITLE[harness];
  const meta = providerMetaLine(entry, probed);
  const muted = probed && !available;
  return (
    <div className="provider-cli-item" data-muted={muted || undefined}>
      <Button
        variant="item"
        controlHeight="auto"
        padding={{ block: "xl", inline: "md" }}
        selected={selected}
        disabled={disabled}
        className="provider-cli-option"
        tooltip={title}
        tooltipWhen="overflow"
        aria-current={selected ? "true" : undefined}
        aria-label={[
          title,
          meta,
          entry.isDefault ? t("Default provider") : "",
          entry.updateAvailable ? t("Update available") : "",
        ]
          .filter(Boolean)
          .join(", ")}
        onClick={() => onSelect(harness)}
      >
        {harness === "acp" ? (
          <Bot className="icon-md shrink-0" aria-hidden />
        ) : (
          <HarnessIcon harness={harness} className="icon-md shrink-0" />
        )}
        <span className="provider-cli-option-copy">
          <Text
            as="span"
            size="secondary"
            tone="inherit"
            leading="snug"
            className="provider-cli-option-name"
          >
            <Text size="inherit" tone="inherit" truncate>
              {title}
            </Text>
            {entry.isDefault ? (
              <Tooltip label={t("New conversations start with this provider")}>
                <Text tone="secondary" className="shrink-0" aria-label={t("Default provider")}>
                  <Check className="icon-sm" aria-hidden />
                </Text>
              </Tooltip>
            ) : null}
          </Text>
          {meta ? (
            <Text
              as="span"
              size="caption"
              tone={authMetaTone(entry.auth?.tone)}
              leading="snug"
              truncate
              className="provider-cli-option-meta"
            >
              {meta}
            </Text>
          ) : null}
        </span>
      </Button>
      {available ? (
        <Tooltip label={t("Show {p0} in the model picker", { p0: title })}>
          <span className="provider-cli-item-action">
            <Toggle
              label={t("Show {p0} in the model picker", { p0: title })}
              on={entry.inPicker}
              onChange={(visible) => onPickerVisible(harness, visible)}
              disabled={entry.pickerLocked || disabled}
            />
          </span>
        </Tooltip>
      ) : probed && harness !== "acp" ? (
        <Button
          size="sm"
          variant="ghost"
          className="provider-cli-item-action"
          disabled={disabled}
          aria-label={t("Set up {p0}", { p0: title })}
          onClick={() => onSetup(harness)}
        >
          {t("Set up")}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Wide-screen provider navigation. Installed providers lead; the rest wait in a collapsed,
 * muted "Available to install" group; the generic ACP provider ("Add provider") closes the list.
 */
export function ProviderList({
  entries,
  active,
  probed,
  disabled,
  onSelect,
  onPickerVisible,
  onSetup,
}: {
  entries: ProviderListEntry[];
  active: HarnessId | null;
  probed: boolean;
  disabled: boolean;
  onSelect: (harness: HarnessId) => void;
  onPickerVisible: (harness: HarnessId, visible: boolean) => void;
  onSetup: (harness: HarnessId) => void;
}) {
  useLocale();
  const grokAuth = useGrokSignInState(
    probed && entries.some((entry) => entry.harness === "grok" && entry.available),
  );
  const [expanded, setExpanded] = useState(false);
  const generic = entries.find((entry) => entry.harness === "acp");
  const listed = entries.filter((entry) => entry.harness !== "acp");
  // Until the first probe finishes nothing is known to be missing, so nothing is grouped away.
  const installed = probed ? listed.filter((entry) => entry.available) : listed;
  const missing = probed ? listed.filter((entry) => !entry.available) : [];
  // A selected provider is never hidden inside the collapsed group.
  const open = expanded || missing.some((entry) => entry.harness === active);
  const item = (entry: ProviderListEntry) => (
    <ProviderListItem
      key={entry.harness}
      entry={entry.harness === "grok" ? { ...entry, auth: grokAuth } : entry}
      probed={probed}
      selected={active === entry.harness}
      disabled={disabled}
      onSelect={onSelect}
      onPickerVisible={onPickerVisible}
      onSetup={onSetup}
    />
  );
  return (
    <nav className="provider-cli-selector" aria-label={t("Providers")}>
      {installed.map(item)}
      {missing.length > 0 ? (
        <Disclosure
          variant="row"
          size="sm"
          className="provider-cli-more"
          tone="secondary"
          summary={t("Available to install")}
          count={missing.length}
          open={open}
          onOpenChange={setExpanded}
        >
          <div className="provider-cli-missing">{missing.map(item)}</div>
        </Disclosure>
      ) : null}
      {generic ? (
        <div {...surfaceAttributes({ frame: "settings", edge: "block-start" }, "provider-cli-add")}>
          {item(generic)}
        </div>
      ) : null}
    </nav>
  );
}
