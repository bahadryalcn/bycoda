import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Modal } from "../../../shared/ui/Modal";
import { t, useLocale } from "../../../shared/i18n";
import {
  Group,
  Row,
  Segmented,
  SettingsFeedback,
  Toggle,
} from "../../settings/ui/settingsControls";
import {
  localVoiceBackend,
  type VoiceRuntimeStatus,
  type VoiceSetupStatus,
} from "../model/localVoiceClient";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  useVoiceSettings,
  voiceRuntimeSettings,
  type VoiceSettings as Preferences,
} from "../model/voiceSettings";
import styles from "./VoiceSettings.module.css";

type PathKey = "python" | "whisperPath" | "ttsPath";
type Failure = { message: string; detail: string };
function checkFailure(cause: unknown): Failure {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return {
    message:
      detail === "Disconnect voice before installing."
        ? t("Disconnect voice before installing.")
        : /not connected|timed? out|timeout/i.test(detail)
          ? t("This computer is unavailable. Try again.")
          : /Update bycoda Host/.test(detail)
            ? t("Update bycoda to set up voice.")
            : t("Couldn't check voice setup. Try again."),
    detail,
  };
}
function stageLabel(stage: VoiceSetupStatus["stage"]) {
  switch (stage) {
    case "packages":
      return t("Installing voice support…");
    case "models":
      return t("Downloading voice files…");
    case "checking":
      return t("Finishing voice setup…");
    default:
      return t("Preparing voice setup…");
  }
}
export function VoiceSettings() {
  useLocale();
  const settings = useVoiceSettings();
  const [result, setResult] = useState<VoiceRuntimeStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure>();
  const [checkedKey, setCheckedKey] = useState("");
  const [locating, setLocating] = useState(false);
  const [job, setJob] = useState<VoiceSetupStatus>({ state: "idle" });
  const request = useRef(0);
  const mounted = useRef(true);
  const starting = useRef(false);
  const configKey = JSON.stringify(voiceRuntimeSettings(settings));
  const currentKey = useRef(configKey);
  currentKey.current = configKey;
  const installing = job.state === "installing";
  const change = (patch: Partial<Preferences>) =>
    saveVoiceSettings({ ...loadVoiceSettings(), ...patch });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  const check = useCallback(async () => {
    const id = ++request.current;
    setCheckedKey(configKey);
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const found = await localVoiceBackend.inspect(JSON.parse(configKey));
      if (mounted.current && id === request.current) setResult(found);
    } catch (cause) {
      if (mounted.current && id === request.current) setError(checkFailure(cause));
    } finally {
      if (mounted.current && id === request.current) setBusy(false);
    }
  }, [configKey]);
  useEffect(() => {
    request.current++;
    if (!settings.enabled || installing) return;
    const timer = setTimeout(() => void check(), 500);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [settings.enabled, check, installing]);
  const acceptJob = useCallback((status: VoiceSetupStatus) => {
    if (!mounted.current) return;
    setJob(status);
    if (status.state === "ready" && status.config && status.requestedConfig) {
      const saved = loadVoiceSettings();
      const original = voiceRuntimeSettings({
        ...saved,
        python: "",
        whisperPath: "",
        ttsPath: "",
        ...status.requestedConfig,
      });
      if (JSON.stringify(voiceRuntimeSettings(saved)) === JSON.stringify(original))
        saveVoiceSettings({ ...saved, ...status.config });
    }
  }, []);
  useEffect(() => {
    if (!settings.enabled) return;
    let active = true;
    void localVoiceBackend
      .setupStatus()
      .then((status) => {
        if (active && (status.state === "installing" || status.state === "ready"))
          acceptJob(status);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [settings.enabled, acceptJob]);
  useEffect(() => {
    if (!installing) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (starting.current) {
        timer = setTimeout(() => void poll(), 1500);
        return;
      }
      try {
        const status = await localVoiceBackend.setupStatus();
        if (!active) return;
        setError(undefined);
        acceptJob(status);
        if (status.state !== "installing") return;
      } catch (cause) {
        if (!active) return;
        setError(checkFailure(cause));
      }
      if (active) timer = setTimeout(() => void poll(), 1500);
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [installing, acceptJob]);
  async function install() {
    if (starting.current || installing) return;
    starting.current = true;
    request.current++;
    setBusy(false);
    setError(undefined);
    setJob({ state: "installing", stage: "environment" });
    try {
      acceptJob(await localVoiceBackend.setup(JSON.parse(configKey)));
    } catch (cause) {
      if (mounted.current) {
        setJob({ state: "idle" });
        setCheckedKey(currentKey.current);
        setError(checkFailure(cause));
      }
    } finally {
      starting.current = false;
    }
  }
  async function browse(key: PathKey) {
    const before = currentKey.current;
    try {
      const path = await open({
        directory: key !== "python",
        multiple: false,
        title: t(key === "python" ? "Choose Python executable" : "Choose model folder"),
      });
      if (mounted.current && currentKey.current === before && typeof path === "string") {
        setJob({ state: "idle" });
        change({ [key]: path });
      }
    } catch (cause) {
      if (mounted.current)
        setError({ message: t("Enter the location below."), detail: String(cause) });
    }
  }
  const checked = checkedKey === configKey;
  const ready = checked && result?.ready && !installing;
  const visibleError = installing || checked ? error : undefined;
  const setupFailed = job.state === "error";
  const pythonMissing = setupFailed && job.error === "python_missing";
  const message =
    visibleError?.message ??
    (installing
      ? stageLabel(job.stage)
      : setupFailed
        ? pythonMissing
          ? t("Install Python to continue.")
          : t("Voice setup couldn't finish. Try again.")
        : ready
          ? t("Voice is ready")
          : !checked || busy
            ? t("Checking voice setup…")
            : t("Voice setup is needed"));
  const detail = visibleError?.detail ?? (setupFailed ? job.detail : undefined);
  const paths: [PathKey, string, string][] = [
    ["python", "Python", "voice-python"],
    ["whisperPath", "Speech recognition model", "voice-whisper"],
    ...(settings.natural
      ? [["ttsPath", "Natural voice model", "voice-tts"] as [PathKey, string, string]]
      : []),
  ];
  return (
    <Group title={t("Voice companion")} layout="full">
      <Row
        id="voice-companion"
        label={t("Enable voice companion")}
        description={t(
          "Talk to your session while the agent works. Audio is processed on this computer.",
        )}
      >
        <Toggle
          label={t("Enable voice companion")}
          on={settings.enabled}
          disabled={installing}
          onChange={(enabled) => change({ enabled })}
        />
      </Row>
      {settings.enabled ? (
        <>
          <fieldset className={styles.engine} disabled={installing}>
            <Row id="voice-engine" label={t("Reply voice")}>
              <Segmented
                label={t("Reply voice")}
                value={settings.natural ? "natural" : "system"}
                options={[
                  { value: "natural", label: t("Natural") },
                  { value: "system", label: t("System voice") },
                ]}
                onChange={(value) => {
                  setJob({ state: "idle" });
                  change({ natural: value === "natural" });
                }}
              />
            </Row>
          </fieldset>
          <div className={styles.setup}>
            <div className={styles.statusRow}>
              <SettingsFeedback
                state={
                  visibleError || setupFailed
                    ? "error"
                    : ready
                      ? "success"
                      : installing || busy || !checked
                        ? "loading"
                        : "empty"
                }
              >
                {message}
              </SettingsFeedback>
              {detail ? (
                <InfoPopover label={t("Technical details")}>
                  <p className={styles.detail}>{detail}</p>
                </InfoPopover>
              ) : null}
            </div>
            {!installing ? (
              <div className={styles.actions}>
                {pythonMissing ? (
                  <Button
                    variant="primary"
                    onClick={() =>
                      void openUrl("https://www.python.org/downloads/release/python-31210/").catch(
                        (cause) => {
                          setError({
                            message: t("Open python.org to install Python 3.10–3.12."),
                            detail: String(cause),
                          });
                        },
                      )
                    }
                  >
                    {t("Get Python")}
                  </Button>
                ) : !ready && checked && !busy && !visibleError ? (
                  <Button variant="primary" onClick={() => void install()}>
                    {t("Install")}
                  </Button>
                ) : null}
                <Button onClick={() => setLocating(true)}>{t("Locate existing")}</Button>
                {visibleError || ready || pythonMissing ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setJob({ state: "idle" });
                      void check();
                    }}
                    disabled={busy}
                  >
                    {t(visibleError ? "Try again" : "Check again")}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {installing || (!ready && !visibleError && !busy && checked && !pythonMissing) ? (
              <p className={styles.hint}>
                {installing
                  ? t("You can leave this page. Setup will continue.")
                  : t("Downloads voice files once. This may use several GB.")}
              </p>
            ) : null}
          </div>
          {locating ? (
            <Modal
              title={t("Locate voice files")}
              size="md"
              onClose={() => setLocating(false)}
              footer={
                <Button variant="primary" onClick={() => setLocating(false)}>
                  {t("Done")}
                </Button>
              }
            >
              <div className={styles.locations}>
                {paths.map(([key, label, id]) => (
                  <div className={styles.fieldRow} key={key}>
                    <Row id={id} label={t(label)}>
                      <div className={styles.path}>
                        <TextField
                          label={t(label)}
                          hideLabel
                          aria-label={t(label)}
                          value={settings[key]}
                          placeholder={t("Automatic detection")}
                          onChange={(event) => {
                            setJob({ state: "idle" });
                            change({ [key]: event.target.value });
                          }}
                        />
                        <Button disabled={installing} onClick={() => void browse(key)}>
                          {t("Browse")}
                        </Button>
                      </div>
                    </Row>
                  </div>
                ))}
                <p className={styles.hint}>
                  {t("Leave a location empty to find it automatically.")}
                </p>
                {visibleError ? (
                  <SettingsFeedback state="error">{visibleError.message}</SettingsFeedback>
                ) : null}
              </div>
            </Modal>
          ) : null}
        </>
      ) : null}
    </Group>
  );
}
