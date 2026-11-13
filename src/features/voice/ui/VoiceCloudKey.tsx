import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { t } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { Row, SettingsFeedback } from "../../settings/ui/settingsControls";
import { localVoiceBackend, type VoiceCloudProvider } from "../model/localVoiceClient";

const KEY_COPY: Record<VoiceCloudProvider, { label: () => string; description: () => string }> = {
  elevenlabs: {
    label: () => t("ElevenLabs API key"),
    description: () =>
      t("Stored encrypted on this computer. Only reply text is sent to ElevenLabs."),
  },
  openrouter: {
    label: () => t("OpenRouter API key"),
    description: () =>
      t("Stored encrypted on this computer. Dictation audio is sent to OpenRouter."),
  },
};

/** A cloud voice API key: stored encrypted by the Host on this computer, never shown again. */
export function VoiceCloudKey({
  provider,
  onSaved,
}: {
  provider: VoiceCloudProvider;
  onSaved?: () => void;
}) {
  const copy = KEY_COPY[provider];
  const [saved, setSaved] = useState<boolean | undefined>();
  const [statusError, setStatusError] = useState(false);
  const [checking, setChecking] = useState(true);
  const [revision, setRevision] = useState(0);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const generation = useRef(0);
  const previousProvider = useRef(provider);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Own the mounted Host credential-status request and discard results after provider changes or unmount.
  useEffect(() => {
    let active = true;
    generation.current += 1;
    if (previousProvider.current !== provider) {
      setKey("");
      previousProvider.current = provider;
    }
    mounted.current = true;
    setSaved(undefined);
    setBusy(null);
    setError("");
    setChecking(true);
    setStatusError(false);
    void localVoiceBackend
      .cloudStatus()
      .then((status) => {
        if (active) setSaved(status[provider]);
      })
      .catch(() => {
        if (active) setStatusError(true);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [provider, revision]);
  async function apply(value: string | null) {
    const request = generation.current;
    setBusy(value === null ? "remove" : "save");
    setError("");
    try {
      const status = await localVoiceBackend.setCloudKey(provider, value);
      if (!mounted.current || request !== generation.current) return;
      setSaved(status[provider]);
      setKey("");
      onSaved?.();
    } catch (cause) {
      if (mounted.current && request === generation.current)
        setError(t(errorText(cause).trim() || "The key could not be saved."));
    } finally {
      if (mounted.current && request === generation.current) setBusy(null);
    }
  }
  return (
    <Row
      id={`voice-${provider}-key`}
      label={copy.label()}
      description={copy.description()}
      feedback={
        statusError ? (
          <SettingsFeedback
            state="error"
            action={
              <Button onClick={() => setRevision((value) => value + 1)}>{t("Retry status")}</Button>
            }
          >
            {t("Could not check saved key. Retry status before changing it.")}
          </SettingsFeedback>
        ) : error ? (
          <SettingsFeedback state="error">{error}</SettingsFeedback>
        ) : checking ? (
          <SettingsFeedback state="loading" immediate>
            {t("Checking saved key…")}
          </SettingsFeedback>
        ) : undefined
      }
      stacked
    >
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (saved !== undefined && !busy && key.trim()) void apply(key.trim());
        }}
      >
        {saved ? <Badge tone="success">{t("Key saved")}</Badge> : null}
        <PasswordField
          label={copy.label()}
          hideLabel
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder={
            saved === undefined
              ? t("Key status unknown")
              : saved
                ? t("Replace key")
                : t("Paste API key")
          }
          disabled={busy !== null}
          autoComplete="off"
          spellCheck={false}
          fieldClassName="min-w-48 flex-1"
        />
        <Button
          type="submit"
          loading={busy === "save"}
          loadingLabel={t("Checking key…")}
          disabled={busy !== null || saved === undefined || !key.trim()}
        >
          {t("Save")}
        </Button>
        {saved ? (
          <Button
            type="button"
            variant="ghost"
            loading={busy === "remove"}
            disabled={busy !== null}
            onClick={() => void apply(null)}
          >
            {t("Remove")}
          </Button>
        ) : null}
      </form>
    </Row>
  );
}
