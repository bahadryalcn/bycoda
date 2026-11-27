import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { StatusText } from "../../../shared/ui/StatusText";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { t } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { Row, SettingsFeedback } from "../../../shared/ui/settings";
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
  const [error, setError] = useState<{ title: string; detail: string }>();
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
    setError(undefined);
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
    setError(undefined);
    try {
      const status = await localVoiceBackend.setCloudKey(provider, value);
      if (!mounted.current || request !== generation.current) return;
      setSaved(status[provider]);
      setKey("");
      onSaved?.();
    } catch (cause) {
      if (mounted.current && request === generation.current)
        setError({
          title:
            value === null
              ? t("Could not remove the voice API key.")
              : t("Could not save the voice API key."),
          detail: errorText(cause),
        });
    } finally {
      if (mounted.current && request === generation.current) setBusy(null);
    }
  }
  return (
    <Row
      id={`voice-${provider}-key`}
      label={
        <span className="inline-flex min-w-0 items-center gap-2">
          {copy.label()}
          {saved ? <StatusText tone="done">{t("Saved")}</StatusText> : null}
        </span>
      }
      description={copy.description()}
      feedback={
        statusError ? (
          <SettingsFeedback
            state="error"
            action={{ label: t("Retry status"), onClick: () => setRevision((value) => value + 1) }}
          >
            {t("Could not check saved key. Retry status before changing it.")}
          </SettingsFeedback>
        ) : error ? (
          <SettingsFeedback
            state="error"
            extra={error.detail && <ErrorDetails title={error.title} detail={error.detail} />}
          >
            {error.title}
          </SettingsFeedback>
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
        <PasswordField
          label={copy.label()}
          hideLabel
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder={t("Paste API key")}
          disabled={busy !== null}
          autoComplete="off"
          spellCheck={false}
          fieldClassName="min-w-48 flex-1"
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          loading={busy === "save"}
          loadingLabel={t("Checking key…")}
          disabled={busy !== null || saved === undefined || !key.trim()}
          disabledReason={
            busy !== null
              ? t("Wait for the current key action to finish.")
              : saved === undefined
                ? t("Checking the saved key first.")
                : undefined
          }
        >
          {t("Save")}
        </Button>
        {saved ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            tone="danger"
            loading={busy === "remove"}
            disabled={busy !== null}
            disabledReason={t("Wait for the current key action to finish.")}
            onClick={() => void apply(null)}
          >
            {t("Remove")}
          </Button>
        ) : null}
      </form>
    </Row>
  );
}
