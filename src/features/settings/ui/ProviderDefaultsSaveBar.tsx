import { Badge } from "../../../shared/ui/Badge";
import "./ProviderDefaults.css";
import type { DefaultsDraft, DefaultsTarget } from "../model/providerDefaultsDraft";
import { prepareDefaultsDraft } from "../model/providerDefaultsSupport";
import { HARNESS_TITLE, type HarnessId } from "../../../shared/model/harnessIdentity";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { LayoutGrid } from "../../../shared/ui/icons";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { InlineError } from "../../../shared/ui/InlineError";
import { SettingsSaveBar, type PendingChange } from "../../../shared/ui/settings";

export type DefaultsSaveState =
  | { state: "idle" }
  | { state: "saved"; target: string }
  | { state: "error"; message: string; failed?: string[] };

/**
 * Bottom bar of Providers > Defaults: what the pending changes apply to, how many there are,
 * and whether the last save reached storage. Stays in view while the form scrolls.
 */
export function ProviderDefaultsSaveBar({
  changes,
  saveState,
  saving = false,
  onSave,
  onDiscard,
  draft,
  onDraftChange,
  activeProvider,
  target = { kind: "global" },
  providers = [],
}: {
  draft?: DefaultsDraft;
  onDraftChange?: (draft: DefaultsDraft) => void;
  activeProvider?: HarnessId;
  /** Where the page saves; "All providers" copies the source's saved values from there. */
  target?: DefaultsTarget;
  providers?: HarnessId[];
  /** Every unsaved field across providers and accounts. */
  changes: readonly PendingChange[];
  saveState: DefaultsSaveState;
  saving?: boolean;
  onSave: () => boolean | Promise<boolean>;
  onDiscard: () => void;
}) {
  useLocale();
  const pending = changes.length;
  const skips =
    draft && activeProvider ? prepareDefaultsDraft(draft, activeProvider, providers, target).skipped : [];
  return (
    <SettingsSaveBar
      id="models-defaults"
      title={t("Defaults")}
      changes={changes}
      pending={saving}
      saved={saveState.state === "saved"}
      saveLabel={saveState.state === "error" && pending > 0 ? t("Retry") : undefined}
      onSave={onSave}
      onDiscard={onDiscard}
      leading={
        <>
          {pending > 0 && draft && onDraftChange && activeProvider && providers.length > 1 ? (
            <>
              <Text size="caption" tone="muted" className="whitespace-nowrap">
                {t("Apply to")}
              </Text>
              <SegmentedControl
                label={t("Apply to")}
                value={draft.providerScope ?? "this"}
                options={[
                  {
                    value: "this",
                    label: HARNESS_TITLE[activeProvider],
                    icon: <HarnessIcon harness={activeProvider} className="icon-sm" />,
                  },
                  {
                    value: "all",
                    label: t("All providers"),
                    icon: <LayoutGrid className="icon-sm" />,
                  },
                ]}
                onValueChange={(value) =>
                  onDraftChange({ ...draft, providerScope: value === "all" ? "all" : undefined })
                }
              />
            </>
          ) : null}
          {skips.length ? (
            <div className="provider-defaults-notes">
              <Badge size="xs" tone="warning">
                {skips.length === 1
                  ? t("1 field skipped")
                  : t("{p0} fields skipped", { p0: skips.length })}
              </Badge>
              <InfoPopover label={t("Apply details")}>
                {skips.map((skip) => (
                  <Text
                    key={`${skip.harness}:${skip.field}`}
                    as="p"
                    size="caption"
                    tone="muted"
                    className="provider-save-bar-note"
                  >
                    {t("{p0}: {p1} is not available for {p2}", {
                      p0: skip.field,
                      p1: skip.value ?? t("Automatic"),
                      p2: HARNESS_TITLE[skip.harness],
                    })}
                  </Text>
                ))}
              </InfoPopover>
            </div>
          ) : null}
        </>
      }
      successLabel={
        saveState.state === "saved" ? t("Saved to {p0}", { p0: saveState.target }) : undefined
      }
    >
      {saveState.state === "error" ? (
        <InlineError>{t("Not saved. {p0}", { p0: saveState.message })}</InlineError>
      ) : null}
    </SettingsSaveBar>
  );
}
