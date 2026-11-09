import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { TextField } from "../../../shared/ui/TextField";
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
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void localVoiceBackend
      .cloudStatus()
      .then((status) => mounted.current && setSaved(status[provider]))
      .catch(() => mounted.current && setSaved(false));
    return () => {
      mounted.current = false;
    };
  }, [provider]);
  async function apply(value: string | null) {
    setBusy(value === null ? "remove" : "save");
    setError("");
    try {
      const status = await localVoiceBackend.setCloudKey(provider, value);
      if (!mounted.current) return;
      setSaved(status[provider]);
      setKey("");
      onSaved?.();
    } catch (cause) {
      if (mounted.current) setError(t(errorText(cause).trim() || "The key could not be saved."));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }
  return (
    <Row
      id={`voice-${provider}-key`}
      label={copy.label()}
      description={copy.description()}
      feedback={error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : undefined}
      stacked
    >
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (key.trim()) void apply(key.trim());
        }}
      >
        {saved ? <Badge tone="success">{t("Key saved")}</Badge> : null}
        <TextField
          label={copy.label()}
          hideLabel
          type="password"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder={saved ? t("Replace key") : t("Paste API key")}
          disabled={busy !== null}
          autoComplete="off"
          spellCheck={false}
          fieldClassName="min-w-48 flex-1"
        />
        <Button
          type="submit"
          loading={busy === "save"}
          loadingLabel={t("Checking key…")}
          disabled={busy !== null || !key.trim()}
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
