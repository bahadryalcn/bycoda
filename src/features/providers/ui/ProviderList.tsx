import { useId, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { ArrowDownCircle, ChevronRight } from "../../../shared/ui/icons";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { HARNESS_TITLE, type HarnessId } from "../../sessions/model/session";
import { Toggle } from "../../settings/ui/settingsControls";
import type { ProviderAuthState } from "./providerStatus";

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
};

/** The one-line summary under a provider's name: version, sign-in and picker state. */
export function providerMetaLine(entry: ProviderListEntry, probed: boolean): string {
  if (!probed) return t("Checking CLI…");
  if (!entry.available) return entry.harness === "acp" ? t("Add provider") : t("Not installed");
  const parts = [
    entry.version,
    entry.auth?.label,
    entry.pickerLocked ? t("Hidden globally") : !entry.inPicker ? t("Hidden") : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : t("CLI detected");
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
        selected={selected}
        disabled={disabled}
        className="provider-cli-option"
        tooltip={title}
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
        <HarnessIcon harness={harness} className="icon-md shrink-0" />
        <span className="provider-cli-option-copy">
          <span className="provider-cli-option-name">
            <span className="truncate">{title}</span>
            {entry.isDefault ? (
              <Badge size="sm" className="shrink-0">
                {t("Default")}
              </Badge>
            ) : null}
          </span>
          <span className="provider-cli-option-meta" data-tone={entry.auth?.tone}>
            {meta}
          </span>
        </span>
        {entry.updateAvailable ? (
          <ArrowDownCircle
            className="icon-sm shrink-0 text-accent"
            aria-hidden
            strokeWidth={1.75}
          />
        ) : null}
      </Button>
      {available ? (
        <span className="provider-cli-item-action">
          <Toggle
            label={t("Show {p0} in the model picker", { p0: title })}
            on={entry.inPicker}
            onChange={(visible) => onPickerVisible(harness, visible)}
            disabled={entry.pickerLocked || disabled}
          />
        </span>
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
  const groupId = useId();
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
      entry={entry}
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
        <>
          <Button
            variant="ghost"
            size="sm"
            align="start"
            fullWidth
            motion="none"
            className="provider-cli-more"
            aria-expanded={open}
            aria-controls={groupId}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronRight
              aria-hidden
              className="icon-xs"
              strokeWidth={1.75}
              data-open={open || undefined}
            />
            {t("Available to install")}
            <span className="provider-cli-more-count">{missing.length}</span>
          </Button>
          <div id={groupId} className="provider-cli-missing" hidden={!open}>
            {missing.map(item)}
          </div>
        </>
      ) : null}
      {generic ? <div className="provider-cli-add">{item(generic)}</div> : null}
    </nav>
  );
}
