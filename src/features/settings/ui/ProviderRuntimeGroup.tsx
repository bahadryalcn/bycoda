import { t, useLocale } from "../../../shared/i18n";
import { isHarnessAvailable } from "../../../integrations/harness/core/availability";
import { HARNESS_TITLE, type HarnessId } from "../../../shared/model/harnessIdentity";
import { Group, Row, Toggle } from "./settingsControls";

/** Account-side options; CLI setup belongs to ProviderCliTab. */
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
  if (harness !== "claude" && !isHarnessAvailable(harness)) return null;
  const options = (
    <Group layout="full" title={t("Options")}>
      {/* The one-column layout has no provider list, so its picker switch moves here. */}
      {isHarnessAvailable(harness) ? (
        <div className="provider-picker-narrow" data-settings-part="narrow-picker">
          <Row label={t("Show in picker")}>
            <Toggle
              label={t("Show {p0} in the model picker", { p0: HARNESS_TITLE[harness] })}
              on={inPicker}
              onChange={onPickerVisible}
            />
          </Row>
        </div>
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
  return harness === "claude" ? options : <div className="provider-picker-narrow">{options}</div>;
}
