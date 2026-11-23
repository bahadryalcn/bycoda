import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { Text } from "../../../shared/ui/Text";
import { openExternal } from "../../../platform/tauri/openExternal";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { TextField } from "../../../shared/ui/TextField";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { LiveText } from "../../../shared/ui/LiveText";
import { Modal } from "../../../shared/ui/Modal";
import { t } from "../../../shared/i18n";
import { SettingsFeedback } from "../../../shared/ui/settings";
import type { VoiceSettings as Preferences } from "../model/voiceSettings";
import type { PathKey, VoiceSetup } from "./useVoiceSetup";
import styles from "./VoiceSettings.module.css";

/** Setup status, install and recovery actions, and the Locate voice files dialog. */
export function VoiceSetupRow({
  setup,
  settings,
  change,
}: {
  setup: VoiceSetup;
  settings: Preferences;
  change: (patch: Partial<Preferences>) => void;
}) {
  const { installing, busy, ready, visibleError, pythonMissing, message, detail } = setup;
  const paths: [PathKey, string, string][] = [
    ["python", "Python", "voice-python"],
    ["whisperPath", "Speech recognition model", "voice-whisper"],
    // Only VoxCPM2 uses a model folder the owner can choose.
    ...(settings.natural && settings.engine === "voxcpm2"
      ? [["ttsPath", "Natural voice model", "voice-tts"] as [PathKey, string, string]]
      : []),
  ];
  return (
    <>
      <Row
        id="voice-setup"
        label={settings.enabled ? t("Voice setup") : t("Dictation setup")}
        description={setup.setupHint}
        feedback={
          setup.setupError ? (
            <SettingsFeedback state="error">{message}</SettingsFeedback>
          ) : undefined
        }
      >
        {/* A failed check says so once, in the feedback line; the badge carries every other state. */}
        {setup.setupError ? null : (
          <Badge tone={ready ? "success" : setup.working ? "info" : "warning"}>
            <LiveText text={message} />
          </Badge>
        )}
        {detail ? (
          <InfoPopover label={t("Technical details")}>
            <Text as="p" size="caption" tone="secondary" leading="normal" className={styles.detail}>
              {detail}
            </Text>
          </InfoPopover>
        ) : null}
        {!installing ? (
          <>
            {setup.gpuUnavailable ? (
              <Button
                onClick={() => {
                  setup.resetJob();
                  change({ device: "auto" });
                }}
              >
                {t("Use automatic selection")}
              </Button>
            ) : null}
            {pythonMissing ? (
              // One primary per state: without Python the only next step is Get Python.
              <Button
                variant="primary"
                onClick={() =>
                  void openExternal("https://www.python.org/downloads/release/python-31210/").catch(
                    (cause) => {
                      setup.setError({
                        message: t("Open python.org to install Python 3.10–3.12."),
                        detail: String(cause),
                      });
                    },
                  )
                }
              >
                {t("Get Python")}
              </Button>
            ) : !ready && !visibleError ? (
              <Button variant="primary" onClick={() => setup.install()}>
                {t("Install")}
              </Button>
            ) : null}
            {setup.gpuUpgrade ? (
              <Button variant="secondary" onClick={() => setup.install()}>
                {t("Install GPU support")}
              </Button>
            ) : null}
            {visibleError ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setup.resetJob();
                  setup.check();
                }}
                disabled={busy}
              >
                {t("Try again")}
              </Button>
            ) : null}
            {/* Python and the models are autodetected; pointing at them is for a setup that is not ready. */}
            {!ready || visibleError ? (
              <Button variant="ghost" onClick={() => setup.setLocating(true)}>
                {t("Locate files")}
              </Button>
            ) : null}
          </>
        ) : null}
      </Row>
      {setup.locating ? (
        <Modal title={t("Locate voice files")} size="md" onClose={setup.closeLocate}>
          <div className={styles.locations}>
            {paths.map(([key, label, id]) => (
              <Row key={key} id={id} label={t(label)} stacked>
                <div className={styles.path}>
                  <TextField
                    label={t(label)}
                    hideLabel
                    aria-label={t(label)}
                    value={settings[key]}
                    placeholder={t("Automatic detection")}
                    onChange={(event) => {
                      setup.resetJob();
                      change({ [key]: event.target.value });
                    }}
                  />
                  <Button
                    disabled={installing || setup.browsing !== null}
                    loading={setup.browsing === key}
                    onClick={() => setup.browse(key)}
                  >
                    {t("Browse")}
                  </Button>
                </div>
              </Row>
            ))}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
