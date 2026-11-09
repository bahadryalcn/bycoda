import { t, useLocale } from "../../../shared/i18n";
import {
  harnessUnavailableHint,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
} from "../../../integrations/harness/core/availability";
import { HARNESS_TITLE, type HarnessId } from "../../../shared/model/harnessIdentity";
import { ProviderBinaryControl } from "./ProviderBinarySettings";
import { Group, Row, Toggle } from "./settingsControls";

/** CLI path, setup and installation help; for Claude Code also its hooks switch. */
export function ProviderRuntimeGroup({
  harness,
  claudeHooks,
  onClaudeHooksChange,
  inPicker,
  onPickerVisible,
}: {
  harness: HarnessId;
  claudeHooks: boolean;
  onClaudeHooksChange: (next: boolean) => void;
  inPicker: boolean;
  onPickerVisible: (visible: boolean) => void;
}) {
  useLocale();
  const missing = hasProbedHarnessAvailability() && !isHarnessAvailable(harness);
  return (
    <Group id={`cli-path-${harness}`} layout="full" title={t("Runtime")}>
      {/* The one-column layout has no provider list, so its picker switch moves here. */}
      {isHarnessAvailable(harness) ? (
        <div className="provider-picker-narrow">
          <Row label={t("Show in picker")}>
            <Toggle
              label={t("Show {p0} in the model picker", { p0: HARNESS_TITLE[harness] })}
              on={inPicker}
              onChange={onPickerVisible}
            />
          </Row>
        </div>
      ) : null}
      <Row label={t("{p0} CLI path and installation", { p0: HARNESS_TITLE[harness] })}>
        <ProviderBinaryControl
          key={harness}
          provider={harness}
          showLabel
          triggerVariant="secondary"
        />
      </Row>
      {missing ? (
        <Row label={t("Installation help")} description={harnessUnavailableHint(harness)} />
      ) : null}
      {harness === "claude" ? (
        <Row
          id="claude-hooks"
          label={t("Claude Code hooks")}
          description={t("Configured hooks run on the next turn.")}
        >
          <Toggle label={t("Claude Code hooks")} on={claudeHooks} onChange={onClaudeHooksChange} />
        </Row>
      ) : null}
    </Group>
  );
}
