import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "../../../shared/ui/Button";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Badge } from "../../../shared/ui/Badge";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { MoreHorizontal } from "../../../shared/ui/icons";
import { VoiceVisualizer } from "./VoiceVisualizer";
import { TextField } from "../../../shared/ui/TextField";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { LiveText } from "../../../shared/ui/LiveText";
import { Modal } from "../../../shared/ui/Modal";
import { t, useLocale } from "../../../shared/i18n";
import {
  saveProfessionalConversationPreset,
  VOICE_PRESET_FAILED,
} from "../model/voiceConversationPreset";
import { saveVoiceTurnEndChoice, VOICE_TURN_CHOICE_FAILED } from "../model/voiceTurnPolicy";
import {
  AdvancedSettings,
  Group,
  Row,
  Segmented,
  Select,
  SettingsFeedback,
  Toggle,
} from "../../settings/ui/settingsControls";
import { checkFailure, setupConfigKey, stageLabel, type Failure } from "./voiceSetupPresentation";
import { VoiceCapabilityStatus } from "./VoiceCapabilityStatus";
import { VoiceCloudKey } from "./VoiceCloudKey";
import { MicrophonePermissionSettings } from "./MicrophonePermissionSettings";
import { speakerEngine, speakerOptions } from "../model/voiceSpeakers";
import {
  localVoiceBackend,
  type VoiceDevice,
  type VoiceRuntimeStatus,
  type VoiceSetupStatus,
} from "../model/localVoiceClient";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  useVoiceSettings,
  voiceRuntimeSettings,
  type VoiceMode,
  type VoiceSettings as Preferences,
  type VoiceVisual,
} from "../model/voiceSettings";
import styles from "./VoiceSettings.module.css";
import { useVoicePersona } from "../model/voicePersona";
import { VoicePersonaDialog, voicePersonaSummary } from "./VoicePersonaDialog";
import { loadVoiceMemory, saveVoiceMemory, useVoiceMemory } from "../model/voiceMemory";
import { useAssistantSnapshot, assistantIdentity } from "../../assistant/model/assistantClient";

type PathKey = "python" | "whisperPath" | "ttsPath";
export function VoiceSettings() {
  const locale = useLocale();
  const { snapshot: assistantSnapshot } = useAssistantSnapshot();
  const assistantName = assistantIdentity(assistantSnapshot?.profile, locale).title;
  const settings = useVoiceSettings();
  const [result, setResult] = useState<VoiceRuntimeStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure>();
  const [presetError, setPresetError] = useState(false);
  const [turnChoiceError, setTurnChoiceError] = useState(false);
  const [checkedKey, setCheckedKey] = useState("");
  const [locating, setLocating] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const persona = useVoicePersona();
  const [editingStyle, setEditingStyle] = useState(false);
  const memory = useVoiceMemory();
  const moreAnchor = useRef<HTMLButtonElement>(null);
  const [browsing, setBrowsing] = useState<PathKey | null>(null);
  const browsePending = useRef(false);
  // Bumped when the Locate dialog closes or voice is turned off, so a picker that
  // resolves later cannot write into a surface the user already left.
  const browseOwner = useRef(0);
  const [job, setJob] = useState<VoiceSetupStatus>({ state: "idle" });
  const request = useRef(0);
  const mounted = useRef(true);
  const starting = useRef(false);
  const setupAttempt = useRef(0);
  const speechEnabled = settings.enabled || settings.dictationEnabled;
  const setupConfig = voiceRuntimeSettings(
    settings.enabled ? settings : { ...settings, natural: false },
  );
  const configKey = JSON.stringify(setupConfig);
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
    // Native host discovery can stall before an RPC timeout exists. Keep a
    // recovery action reachable and discard an eventual answer to this check.
    const timeout = setTimeout(() => {
      if (!mounted.current || id !== request.current) return;
      request.current++;
      setError(checkFailure(new Error("Voice setup check timed out.")));
      setBusy(false);
    }, 20_000);
    try {
      const found = await localVoiceBackend.inspect(JSON.parse(configKey));
      if (mounted.current && id === request.current) setResult(found);
    } catch (cause) {
      if (mounted.current && id === request.current) setError(checkFailure(cause));
    } finally {
      clearTimeout(timeout);
      if (mounted.current && id === request.current) setBusy(false);
    }
  }, [configKey]);
  useEffect(() => {
    request.current++;
    if (!speechEnabled || installing) return;
    const timer = setTimeout(() => void check(), 500);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [speechEnabled, check, installing]);
  const acceptJob = useCallback((status: VoiceSetupStatus) => {
    if (!mounted.current) return;
    setJob(status);
    if (status.state === "ready" && status.config && status.requestedConfig) {
      const saved = loadVoiceSettings();
      const current = voiceRuntimeSettings(saved.enabled ? saved : { ...saved, natural: false });
      if (setupConfigKey(current) === setupConfigKey(status.requestedConfig))
        saveVoiceSettings({
          ...saved,
          ...status.config,
          // Recognition-only setup must not replace companion playback choices.
          ...(!saved.enabled ? { natural: saved.natural, engine: saved.engine } : {}),
        });
    }
  }, []);
  useEffect(() => {
    if (!speechEnabled) {
      browseOwner.current++;
      return;
    }
    let active = true;
    const attempt = setupAttempt.current;
    void localVoiceBackend
      .setupStatus()
      .then((status) => {
        if (
          active &&
          attempt === setupAttempt.current &&
          (status.state === "installing" || status.state === "ready" || status.state === "error")
        )
          acceptJob(status);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [speechEnabled, acceptJob]);
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
    setupAttempt.current++;
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
    if (browsePending.current) return;
    browsePending.current = true;
    setBrowsing(key);
    const before = currentKey.current;
    const owner = browseOwner.current;
    try {
      const path = await open({
        directory: key !== "python",
        multiple: false,
        title: t(key === "python" ? "Choose Python executable" : "Choose model folder"),
      });
      if (
        mounted.current &&
        browseOwner.current === owner &&
        currentKey.current === before &&
        typeof path === "string"
      ) {
        setJob({ state: "idle" });
        change({ [key]: path });
      }
    } catch (cause) {
      if (mounted.current && browseOwner.current === owner)
        setError({ message: t("Enter the location below."), detail: String(cause) });
    } finally {
      browsePending.current = false;
      if (mounted.current) setBrowsing(null);
    }
  }
  const closeLocate = () => {
    browseOwner.current++;
    setLocating(false);
  };
  const checked = checkedKey === configKey;
  const ready = checked && result?.ready && !installing && !error;
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
          ? settings.enabled
            ? t("Voice is ready")
            : t("Dictation is ready")
          : !checked || busy
            ? settings.enabled
              ? t("Checking voice setup…")
              : t("Checking dictation setup…")
            : settings.enabled
              ? t("Voice setup is needed")
              : t("Dictation setup is needed"));
  // A ready CPU-only install can still be accelerated on a detected NVIDIA GPU.
  // Only the High quality voice (VoxCPM2) uses PyTorch; Supertonic runs on the CPU.
  const gpuUpgrade =
    ready &&
    settings.enabled &&
    settings.natural &&
    settings.engine === "voxcpm2" &&
    settings.device !== "cpu" &&
    result?.gpu &&
    result.accelerated === false
      ? result.gpu
      : undefined;
  const detail =
    visibleError?.detail ??
    (setupFailed ? job.detail : checked && !busy ? result?.missing.join(", ") : undefined);
  const setupError = Boolean(visibleError) || setupFailed;
  const working = installing || busy || !checked;
  // One quiet line under "Voice setup"; the status itself is the badge.
  const setupHint = installing
    ? t("You can leave this page. Setup will continue.")
    : gpuUpgrade
      ? t("Natural voice runs on the CPU. Install GPU support to use {p1}.", { p1: gpuUpgrade })
      : !ready && !visibleError && !pythonMissing
        ? t("Downloads voice files once. This may use several GB.")
        : undefined;
  const paths: [PathKey, string, string][] = [
    ["python", "Python", "voice-python"],
    ["whisperPath", "Speech recognition model", "voice-whisper"],
    // Only VoxCPM2 uses a model folder the owner can choose.
    ...(settings.natural && settings.engine === "voxcpm2"
      ? [["ttsPath", "Natural voice model", "voice-tts"] as [PathKey, string, string]]
      : []),
  ];
  // Speaker voice for Supertonic and the cloud conversations.
  const speakerRow = speakerEngine(settings) ? (
    <Row id="voice-speaker" label={t("Speaker")} description={t("The voice that speaks replies.")}>
      <Select
        label={t("Speaker")}
        value={settings.speakers[speakerEngine(settings)!]}
        options={speakerOptions(speakerEngine(settings)!)}
        onChange={(value) =>
          change({ speakers: { ...settings.speakers, [speakerEngine(settings)!]: value } })
        }
      />
    </Row>
  ) : null;
  return (
    <Group title={t("Voice and dictation")} layout="full">
      <VoiceCapabilityStatus
        enabled={speechEnabled}
        checked={checked && (!settings.enabled || settings.mode === "local")}
        busy={busy}
        installing={installing}
        ready={!!ready}
        failed={!!visibleError || setupFailed}
      />
      <Row
        id="dictation-enabled"
        label={t("Enable dictation")}
        description={t(
          "Speak to insert text in the message box. Works independently of voice companion; nothing is sent automatically.",
        )}
      >
        <Toggle
          label={t("Enable dictation")}
          on={settings.dictationEnabled}
          onChange={(dictationEnabled) => change({ dictationEnabled })}
        />
      </Row>
      <Row
        id="voice-companion"
        label={t("Enable voice companion")}
        description={
          settings.mode === "local"
            ? t("Talk to your session while the agent works. Audio is processed on this computer.")
            : t("Talk to your session while the agent works.")
        }
      >
        <Toggle
          label={t("Enable voice companion")}
          on={settings.enabled}
          disabled={installing}
          onChange={(enabled) => change({ enabled })}
        />
      </Row>
      <MicrophonePermissionSettings />
      {speechEnabled ? (
        <>
          {settings.enabled ? (
            <>
              <Row
                id="voice-mode"
                label={t("Conversation")}
                description={
                  settings.mode === "local"
                    ? t(
                        "Speech is recognized on this computer; the session's provider writes replies.",
                      )
                    : t("Voice runs on {p1}. Audio is sent to the provider while voice is on.", {
                        p1: settings.mode === "grok" ? "Grok Voice" : "OpenAI Realtime",
                      })
                }
                disabled={installing}
              >
                <Segmented
                  label={t("Conversation")}
                  value={settings.mode}
                  options={[
                    { value: "local", label: t("Local") },
                    // Signed in through Grok Build and Codex; no separate API key.
                    { value: "grok", label: "Grok Voice" },
                    { value: "openai", label: "OpenAI Realtime" },
                  ]}
                  onChange={(mode) => change({ mode: mode as VoiceMode })}
                />
              </Row>
              {settings.mode !== "local" ? speakerRow : null}
              {settings.mode === "local" ? (
                <>
                  <Row
                    id="voice-engine"
                    label={t("Reply voice")}
                    description={
                      !settings.natural
                        ? t("An installed voice of this computer.")
                        : settings.engine === "voxcpm2"
                          ? t("High quality sounds richer but needs an NVIDIA GPU.")
                          : settings.engine === "elevenlabs"
                            ? t("Natural cloud voice. Only the reply text leaves this computer.")
                            : t("Fast and private: runs on this computer's processor.")
                    }
                    disabled={installing}
                  >
                    <Select
                      label={t("Reply voice")}
                      value={!settings.natural ? "system" : settings.engine}
                      options={[
                        { value: "supertonic", label: t("Natural (Supertonic)") },
                        { value: "voxcpm2", label: t("High quality (VoxCPM2)") },
                        { value: "elevenlabs", label: "ElevenLabs" },
                        { value: "system", label: t("System voice") },
                      ]}
                      onChange={(value) => {
                        setJob({ state: "idle" });
                        change(
                          value === "system"
                            ? { natural: false }
                            : { natural: true, engine: value as Preferences["engine"] },
                        );
                      }}
                    />
                  </Row>
                  {speakerRow}
                  {settings.natural && settings.engine === "elevenlabs" ? (
                    <>
                      <VoiceCloudKey onSaved={() => void check()} />
                      <Row
                        id="voice-elevenlabs-voice"
                        label={t("ElevenLabs voice ID")}
                        description={t("Optional. Leave empty for a multilingual default voice.")}
                      >
                        <TextField
                          label={t("ElevenLabs voice ID")}
                          hideLabel
                          value={settings.elevenVoice}
                          placeholder="JBFqnCBsd6RMkjVDRZzb"
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(event) => {
                            const value = event.target.value.trim();
                            if (/^[A-Za-z0-9]{0,64}$/.test(value)) change({ elevenVoice: value });
                          }}
                        />
                      </Row>
                    </>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
          <Row
            id="voice-setup"
            label={settings.enabled ? t("Voice setup") : t("Dictation setup")}
            description={setupHint}
            feedback={
              setupError ? <SettingsFeedback state="error">{message}</SettingsFeedback> : undefined
            }
          >
            <Badge tone={setupError ? "danger" : ready ? "success" : working ? "info" : "warning"}>
              <LiveText text={setupError ? t("Needs attention") : message} />
            </Badge>
            {detail ? (
              <InfoPopover label={t("Technical details")}>
                <p className={styles.detail}>{detail}</p>
              </InfoPopover>
            ) : null}
            {!installing ? (
              <>
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
                ) : !ready && !visibleError ? (
                  <Button variant="primary" onClick={() => void install()}>
                    {t("Install")}
                  </Button>
                ) : null}
                {gpuUpgrade ? (
                  <Button variant="primary" onClick={() => void install()}>
                    {t("Install GPU support")}
                  </Button>
                ) : null}
                {visibleError ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setJob({ state: "idle" });
                      void check();
                    }}
                    disabled={busy}
                  >
                    {t("Try again")}
                  </Button>
                ) : null}
                <Button
                  ref={moreAnchor}
                  variant="ghost"
                  size="sm"
                  iconOnly
                  label={t("More voice setup actions")}
                  tooltip={t("More voice setup actions")}
                  aria-haspopup="menu"
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  <MoreHorizontal aria-hidden className="icon-sm" />
                </Button>
                {moreOpen ? (
                  <DropdownMenu
                    anchor={moreAnchor}
                    label={t("More voice setup actions")}
                    items={[
                      { kind: "item", id: "locate", label: t("Locate existing") },
                      ...((ready || pythonMissing) && !visibleError
                        ? [
                            {
                              kind: "item" as const,
                              id: "check",
                              label: t("Check again"),
                              disabled: busy,
                            },
                          ]
                        : []),
                    ]}
                    onClose={() => setMoreOpen(false)}
                    onPick={(id) => {
                      setMoreOpen(false);
                      if (id === "locate") setLocating(true);
                      else {
                        setJob({ state: "idle" });
                        void check();
                      }
                    }}
                  />
                ) : null}
              </>
            ) : null}
          </Row>
          {settings.enabled ? (
            <AdvancedSettings
              id="voice-advanced"
              defaultOpen={false}
              keepMounted
              settingIds={[
                "voice-conversation-preset",
                "voice-idle-sleep",
                "voice-manual-turn-end",
                "voice-turn-silence",
                "voice-barge-in",
                "voice-hold-announcements",
                "voice-persona",
                "voice-memory",
                "voice-visual-style",
                "voice-device",
              ]}
              title={
                <>
                  {t("Advanced")}
                  {turnChoiceError || presetError ? (
                    <Badge tone="danger">{t("Needs attention")}</Badge>
                  ) : null}
                </>
              }
            >
              <Row
                id="voice-conversation-preset"
                label={t("Professional conversation")}
                description={t(
                  "Uses a longer pause, allows interruptions, and holds spoken progress updates. You can change each setting afterward.",
                )}
              >
                <div className="space-y-1">
                  <Button
                    onClick={() => {
                      try {
                        saveProfessionalConversationPreset();
                        setPresetError(false);
                        setTurnChoiceError(false);
                      } catch {
                        setPresetError(true);
                      }
                    }}
                  >
                    {t("Apply preset")}
                  </Button>
                  {presetError && (
                    <SettingsFeedback state="error">{t(VOICE_PRESET_FAILED)}</SettingsFeedback>
                  )}
                </div>
              </Row>
              <Row
                id="voice-idle-sleep"
                label={t("Sleep voice when I'm idle")}
                description={t(
                  "Closes the microphone while idle. Returning leaves it off until you press Talk.",
                )}
              >
                <Select
                  label={t("Sleep voice when I'm idle")}
                  value={String(settings.idleSleepMinutes)}
                  options={[
                    { value: "0", label: t("Never") },
                    ...[5, 10, 15, 30, 60].map((minutes) => ({
                      value: String(minutes),
                      label: t("{p0} min", { p0: minutes }),
                    })),
                    ...(![0, 5, 10, 15, 30, 60].includes(settings.idleSleepMinutes)
                      ? [
                          {
                            value: String(settings.idleSleepMinutes),
                            label: t("{p0} min", { p0: settings.idleSleepMinutes }),
                          },
                        ]
                      : []),
                  ]}
                  onChange={(value) => change({ idleSleepMinutes: Number(value) })}
                />
              </Row>
              <Row
                id="voice-manual-turn-end"
                label={t("I decide when my turn ends")}
                description={t(
                  "Long pauses keep listening. Choose Finish turn to send your speech. You can switch back to automatic replies here.",
                )}
              >
                <div className="space-y-1">
                  <Toggle
                    label={t("I decide when my turn ends")}
                    on={settings.manualTurnEnd === true}
                    onChange={(manual) => {
                      try {
                        saveVoiceTurnEndChoice(manual);
                        setTurnChoiceError(false);
                      } catch {
                        setTurnChoiceError(true);
                      }
                    }}
                  />
                  {turnChoiceError && (
                    <SettingsFeedback state="error">{t(VOICE_TURN_CHOICE_FAILED)}</SettingsFeedback>
                  )}
                </div>
              </Row>
              {settings.mode === "openai" && (
                <Row
                  id="voice-semantic-vad"
                  label={t("Experimental OpenAI turn detection")}
                  description={t(
                    "Sends live microphone audio to OpenAI continuously while listening. Automatic mode only; disconnect and reconnect voice to apply. Push to talk is unavailable in this mode.",
                  )}
                >
                  <Toggle
                    label={t("Experimental OpenAI turn detection")}
                    on={settings.experimentalSemanticVad === true}
                    disabled={settings.manualTurnEnd === true}
                    onChange={(experimentalSemanticVad) => change({ experimentalSemanticVad })}
                  />
                </Row>
              )}
              <Row
                id="voice-turn-silence"
                label={t("Wait before replying")}
                description={
                  settings.manualTurnEnd
                    ? t("Automatic pause detection is off. Choose Finish turn when you are ready.")
                    : undefined
                }
              >
                <Select
                  label={t("Wait before replying")}
                  disabled={settings.manualTurnEnd === true}
                  value={String(settings.turnEndSilence ?? 1.2)}
                  options={[
                    { value: "1.2", label: t("Natural pause") },
                    { value: "2.5", label: t("Longer pause") },
                    { value: "4", label: t("Extra time") },
                  ]}
                  onChange={(value) => change({ turnEndSilence: Number(value) })}
                />
              </Row>
              <Row
                id="voice-barge-in"
                label={t("I may interrupt speech")}
                description={t("Lets your speech interrupt the assistant's reply.")}
              >
                <Toggle
                  label={t("I may interrupt speech")}
                  on={settings.allowBargeIn !== false}
                  onChange={(allowBargeIn) => change({ allowBargeIn })}
                />
              </Row>
              <Row id="voice-hold-announcements" label={t("Hold spoken progress updates")}>
                <Toggle
                  label={t("Hold spoken progress updates")}
                  on={settings.holdAnnouncements === true}
                  onChange={(holdAnnouncements) => change({ holdAnnouncements })}
                />
              </Row>
              <Row
                id="voice-persona"
                label={t("Companion identity")}
                description={t("Name, how it addresses you, tone, tasks and ground rules.")}
              >
                <Badge tone="neutral">
                  {assistantSnapshot?.profile.name ? assistantName : voicePersonaSummary(persona)}
                </Badge>
                <Button
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("bycoda:open-assistant", { detail: { tab: "settings" } }),
                    )
                  }
                >
                  {t("Customize")}
                </Button>
                <Button variant="ghost" onClick={() => setEditingStyle(true)}>
                  {t("Voice style")}
                </Button>
              </Row>
              {editingStyle ? (
                <VoicePersonaDialog
                  purpose="edit"
                  styleOnly
                  onClose={() => setEditingStyle(false)}
                />
              ) : null}
              <Row
                id="voice-memory"
                label={t("Memory")}
                description={t("Keeps short notes about you between conversations on this device.")}
              >
                <Button
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("bycoda:open-assistant", { detail: { tab: "memory" } }),
                    )
                  }
                >
                  {t("Manage ({p0})", {
                    p0: assistantSnapshot?.memory.length ?? memory.notes.length,
                  })}
                </Button>
                <Toggle
                  label={t("Memory")}
                  on={memory.enabled}
                  onChange={(enabled) => saveVoiceMemory({ ...loadVoiceMemory(), enabled })}
                />
              </Row>
              {/* A deliberate full-width chooser: four previews need more room than the control column. */}
              <Row id="voice-visual-style" label={t("Visual style")} stacked>
                <SegmentedControl
                  label={t("Visual style")}
                  value={settings.visual}
                  optionIdPrefix="voice-visual"
                  options={(
                    [
                      ["mark", t("bycoda mark")],
                      ["wave", t("Wave")],
                      ["dots", t("Dots")],
                      ["orb", t("Orb")],
                    ] as [VoiceVisual, string][]
                  ).map(([value, label]) => ({
                    value,
                    label,
                    accessory: <VoiceVisualizer visual={value} state="listening" small preview />,
                  }))}
                  onValueChange={(visual) => change({ visual: visual as VoiceVisual })}
                />
              </Row>
              {settings.mode === "local" ? (
                <Row
                  id="voice-device"
                  label={t("Processing")}
                  description={t("Automatic uses a supported NVIDIA GPU when available.")}
                  disabled={installing}
                >
                  <Segmented
                    label={t("Processing")}
                    value={settings.device}
                    options={[
                      { value: "auto", label: t("Automatic") },
                      { value: "gpu", label: t("GPU") },
                      { value: "cpu", label: t("CPU") },
                    ]}
                    onChange={(value) => {
                      setJob({ state: "idle" });
                      change({ device: value as VoiceDevice });
                    }}
                  />
                </Row>
              ) : null}
            </AdvancedSettings>
          ) : (
            <Row
              id="dictation-device"
              label={t("Processing")}
              description={t("Automatic uses a supported NVIDIA GPU when available.")}
              disabled={installing}
            >
              <Segmented
                label={t("Processing")}
                value={settings.device}
                options={[
                  { value: "auto", label: t("Automatic") },
                  { value: "gpu", label: t("GPU") },
                  { value: "cpu", label: t("CPU") },
                ]}
                onChange={(value) => {
                  setJob({ state: "idle" });
                  change({ device: value as VoiceDevice });
                }}
              />
            </Row>
          )}
          {locating ? (
            <Modal
              title={t("Locate voice files")}
              size="md"
              onClose={closeLocate}
              footer={
                <Button variant="primary" onClick={closeLocate}>
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
                        <Button
                          disabled={installing || browsing !== null}
                          loading={browsing === key}
                          onClick={() => void browse(key)}
                        >
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
