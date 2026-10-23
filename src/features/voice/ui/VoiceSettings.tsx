import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { t, useLocale } from "../../../shared/i18n";
import {
  AdvancedSettings,
  Group,
  Row,
  Segmented,
  SettingsFeedback,
  Toggle,
} from "../../settings/ui/settingsControls";
import { localVoiceBackend, type VoiceRuntimeStatus } from "../model/localVoiceClient";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  useVoiceSettings,
  voiceRuntimeSettings,
  type VoiceSettings as Preferences,
} from "../model/voiceSettings";
import styles from "./VoiceSettings.module.css";

export function VoiceSettings() {
  useLocale();
  const settings = useVoiceSettings();
  const [result, setResult] = useState<VoiceRuntimeStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkedKey, setCheckedKey] = useState("");
  const request = useRef(0);
  const configKey = JSON.stringify(voiceRuntimeSettings(settings));
  const change = (patch: Partial<Preferences>) =>
    saveVoiceSettings({ ...loadVoiceSettings(), ...patch });
  const check = useCallback(async () => {
    const id = ++request.current;
    setCheckedKey(configKey);
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      const found = await localVoiceBackend.inspect(JSON.parse(configKey));
      if (id === request.current) setResult(found);
    } catch (cause) {
      if (id === request.current)
        setError(
          cause instanceof Error ? cause.message : t("Voice installation could not be checked."),
        );
    } finally {
      if (id === request.current) setBusy(false);
    }
  }, [configKey]);
  useEffect(() => {
    // Check after editing settles; stale results cannot overwrite newer paths.
    request.current++;
    if (!settings.enabled) return;
    const timer = setTimeout(() => void check(), 500);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [settings.enabled, check]);

  async function browse(key: "python" | "whisperPath" | "ttsPath") {
    try {
      const path = await open({
        directory: key !== "python",
        multiple: false,
        title: t(key === "python" ? "Choose Python executable" : "Choose model folder"),
      });
      if (typeof path === "string") change({ [key]: path });
    } catch {
      setCheckedKey(configKey);
      setError(t("Enter the installation path manually."));
    }
  }
  return (
    <Group title={t("Voice companion")} layout="full">
      <Row
        id="voice-companion"
        label={t("Enable voice companion")}
        description={t(
          "Show the floating voice control. Turning this off hides it and releases the microphone and local voice engines.",
        )}
      >
        <Toggle
          label={t("Enable voice companion")}
          on={settings.enabled}
          onChange={(enabled) => change({ enabled })}
        />
      </Row>
      {settings.enabled ? (
        <>
          <div className={styles.engine}>
            <Row id="voice-engine" label={t("Reply voice")}>
              <Segmented
                label={t("Reply voice")}
                value={settings.natural ? "natural" : "system"}
                options={[
                  { value: "natural", label: t("Natural · VoxCPM2") },
                  { value: "system", label: t("Installed system voice") },
                ]}
                onChange={(value) => change({ natural: value === "natural" })}
              />
            </Row>
          </div>
          <div className={styles.setup}>
            <p className={styles.hint}>
              {t("Existing installations are detected automatically. Audio stays on this device.")}
            </p>
            <div className={styles.checkRow}>
              <Button
                onClick={() => void check()}
                disabled={busy && checkedKey === configKey}
                loading={busy && checkedKey === configKey}
              >
                {t("Check installation")}
              </Button>
              {busy && checkedKey === configKey ? (
                <span role="status" className={styles.hint}>
                  {t("Checking local installation...")}
                </span>
              ) : null}
            </div>
            {error && checkedKey === configKey ? (
              <SettingsFeedback state="error">{error}</SettingsFeedback>
            ) : null}
            {result && checkedKey === configKey ? (
              <SettingsFeedback state={result.ready ? "success" : "warning"}>
                {result.ready
                  ? t("Local voice is ready.")
                  : t("Missing: {p0}", { p0: result.missing.join(", ") })}
                {!result.ready ? (
                  <span className={styles.recovery}>
                    {t("Choose existing folders or follow the setup instructions below.")}
                  </span>
                ) : null}
              </SettingsFeedback>
            ) : null}
            {result && checkedKey === configKey ? (
              <dl className={styles.detected}>
                {(["python", "whisperPath", ...(settings.natural ? ["ttsPath"] : [])] as const).map(
                  (key) => {
                    const name =
                      key === "python"
                        ? "Python"
                        : key === "whisperPath"
                          ? "Whisper model"
                          : "VoxCPM2 model";
                    return (
                      <div key={key}>
                        <dt>{t(name)}</dt>
                        <dd>
                          {result[
                            key as keyof Pick<
                              VoiceRuntimeStatus,
                              "python" | "whisperPath" | "ttsPath"
                            >
                          ]
                            ? t("Detected")
                            : t("Not found")}
                        </dd>
                      </div>
                    );
                  },
                )}
              </dl>
            ) : null}
          </div>
          <AdvancedSettings
            title={t("Installation paths and setup")}
            defaultOpen={false}
            settingIds={["voice-python", "voice-whisper", "voice-tts"]}
          >
            {(
              [
                ["python", "Python executable", "voice-python"],
                ["whisperPath", "Whisper model folder", "voice-whisper"],
                ...(settings.natural ? [["ttsPath", "VoxCPM2 model folder", "voice-tts"]] : []),
              ] as const
            ).map(([key, label, id]) => (
              <div className={styles.fieldRow} key={key}>
                <Row id={id} label={t(label)}>
                  <div className={styles.path}>
                    <TextField
                      label={t(label)}
                      hideLabel
                      aria-label={t(label)}
                      value={settings[key as "python" | "whisperPath" | "ttsPath"]}
                      placeholder={t("Automatic detection")}
                      aria-describedby={
                        result &&
                        checkedKey === configKey &&
                        result[key as "python" | "whisperPath" | "ttsPath"]
                          ? `voice-detected-${key}`
                          : undefined
                      }
                      onChange={(event) => change({ [key]: event.target.value })}
                    />
                    <Button
                      onClick={() => void browse(key as "python" | "whisperPath" | "ttsPath")}
                    >
                      {t("Browse")}
                    </Button>
                    {result &&
                    checkedKey === configKey &&
                    result[key as "python" | "whisperPath" | "ttsPath"] ? (
                      <span id={`voice-detected-${key}`} className={styles.resolved}>
                        {result[key as "python" | "whisperPath" | "ttsPath"]}
                      </span>
                    ) : null}
                  </div>
                </Row>
              </div>
            ))}
            <div className={styles.setup}>
              <p className={styles.hint}>
                {t(
                  "Voice requires a local Python environment and Whisper model. Natural replies also require VoxCPM2. Existing installations are detected automatically; nothing is installed or downloaded without you.",
                )}
              </p>
              <p className={styles.hint}>
                {t(
                  "Use Python 3.10–3.12. Install these packages in the selected environment, then check again. Model downloads may be several GB. GPU acceleration is recommended for natural replies.",
                )}
              </p>
              <code className={styles.command}>
                python -m pip install faster-whisper{settings.natural ? " voxcpm" : ""}
              </code>
              <p className={styles.hint}>
                {t(
                  "Download the models once, or select existing model folders above. Replace python with your selected executable when using a custom environment.",
                )}
              </p>
              <code
                className={styles.command}
              >{`python -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-small')${settings.natural ? "; snapshot_download('openbmb/VoxCPM2')" : ""}"`}</code>
            </div>
          </AdvancedSettings>
        </>
      ) : null}
    </Group>
  );
}
