import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { t } from "../../../shared/i18n";
import { checkFailure, setupConfigKey, stageLabel, type Failure } from "./voiceSetupPresentation";
import {
  localVoiceBackend,
  type VoiceRuntimeStatus,
  type VoiceSetupStatus,
} from "../model/localVoiceClient";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  voiceRuntimeSettings,
  type VoiceSettings as Preferences,
} from "../model/voiceSettings";

export type PathKey = "python" | "whisperPath" | "ttsPath";

/** Local voice setup state: readiness checks, installation jobs and file locations. */
export function useVoiceSetup(
  settings: Preferences,
  change: (patch: Partial<Preferences>) => void,
) {
  const [result, setResult] = useState<VoiceRuntimeStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure>();
  const [checkedKey, setCheckedKey] = useState("");
  const [locating, setLocating] = useState(false);
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
  // Cloud dictation needs no local recognizer installation.
  const speechEnabled =
    settings.enabled || (settings.dictationEnabled && settings.dictationEngine === "local");
  const setupConfig = voiceRuntimeSettings(
    settings.enabled ? settings : { ...settings, natural: false },
  );
  const configKey = JSON.stringify(setupConfig);
  const currentKey = useRef(configKey);
  useLayoutEffect(() => {
    currentKey.current = configKey;
  });
  const installing = job.state === "installing";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  // Failures are handled inside each step; this only catches the unexpected.
  const fail = useCallback((cause: unknown) => {
    if (mounted.current) setError(checkFailure(cause));
  }, []);
  const checkNow = useCallback(async () => {
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
    const timer = setTimeout(() => checkNow().catch(fail), 500);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [speechEnabled, checkNow, fail, installing]);
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
        timer = setTimeout(() => poll().catch(fail), 1500);
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
      if (active) timer = setTimeout(() => poll().catch(fail), 1500);
    };
    timer = setTimeout(() => poll().catch(fail), 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [installing, acceptJob, fail]);
  async function installNow() {
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
  async function browseNow(key: PathKey) {
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
  /** Forgets a finished or failed job so the next check reflects the current choices. */
  const resetJob = () => setJob({ state: "idle" });
  const checked = checkedKey === configKey;
  const ready = Boolean(checked && result?.ready && !installing && !error);
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
  // One quiet line under "Voice setup"; the status itself is the badge.
  const setupHint = installing
    ? t("You can leave this page. Setup will continue.")
    : gpuUpgrade
      ? t("Natural voice runs on the CPU. Install GPU support to use {p1}.", { p1: gpuUpgrade })
      : !ready && !visibleError && !pythonMissing
        ? t("Downloads voice files once. This may use several GB.")
        : undefined;
  return {
    speechEnabled,
    installing,
    busy,
    checked,
    ready,
    visibleError,
    setError,
    setupFailed,
    pythonMissing,
    message,
    gpuUpgrade,
    detail,
    setupError: Boolean(visibleError) || setupFailed,
    working: installing || busy || !checked,
    setupHint,
    check: () => void checkNow().catch(fail),
    install: () => void installNow().catch(fail),
    resetJob,
    locating,
    setLocating,
    closeLocate,
    browsing,
    browse: (key: PathKey) => void browseNow(key).catch(fail),
  };
}

export type VoiceSetup = ReturnType<typeof useVoiceSetup>;
