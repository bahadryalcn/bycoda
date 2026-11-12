import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { RadioGroup } from "../../../../shared/ui/RadioGroup";
import { TextField } from "../../../../shared/ui/TextField";
import { Sparkles } from "../../../../shared/ui/icons";
import {
  assistantBuilderFailureDetail,
  requestAssistantAvatar,
  type AssistantAvatarProvider,
} from "../../model/assistantBuilderClient";
import styles from "./AssistantBuilder.module.css";

/**
 * Prompt, Codex or Gemini choice and Generate for one assistant portrait. The result is only
 * reported as the drafted `image:<id>` value; saving stays with the surrounding form.
 */
export function AvatarGenerator({
  initialPrompt = "",
  onGenerated,
}: {
  initialPrompt?: string;
  onGenerated: (avatar: string) => void;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [provider, setProvider] = useState<AssistantAvatarProvider>("codex");
  const [busy, setBusy] = useState(false);
  /** `null` while nothing failed; "" when the Host gave no reason. */
  const [failure, setFailure] = useState<string | null>(null);
  const epoch = useRef(0);
  useEffect(
    () => () => {
      epoch.current += 1;
    },
    [],
  );
  const trimmed = prompt.trim();

  async function generate() {
    if (!trimmed || busy) return;
    const mine = ++epoch.current;
    setBusy(true);
    setFailure(null);
    try {
      const avatar = await requestAssistantAvatar({ prompt: trimmed, provider });
      if (mine === epoch.current) onGenerated(avatar);
    } catch (error) {
      if (mine === epoch.current) setFailure(assistantBuilderFailureDetail(error));
    } finally {
      if (mine === epoch.current) setBusy(false);
    }
  }
  const start = () => {
    // generate() reports its own failures; this only keeps an unexpected one from going unhandled.
    generate().catch((error: unknown) => setFailure(assistantBuilderFailureDetail(error)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      start();
    }
  };

  return (
    <div className={styles.generator}>
      <TextField
        label={t("Describe the avatar")}
        value={prompt}
        maxLength={600}
        placeholder={t("For example “a calm fox with round glasses”")}
        onChange={(event) => setPrompt(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.generatorRow}>
        <RadioGroup
          variant="inline"
          label={t("Image provider")}
          value={provider}
          options={[
            { value: "codex", label: "Codex" },
            { value: "gemini", label: "Gemini" },
          ]}
          onValueChange={(next) => setProvider(next === "gemini" ? "gemini" : "codex")}
        />
        <Button
          type="button"
          variant="primary"
          tone="accent"
          size="sm"
          startIcon={<Sparkles />}
          loading={busy}
          loadingLabel={t("Drawing…")}
          disabled={!trimmed}
          onClick={start}
        >
          {t("Generate avatar")}
        </Button>
      </div>
      {busy ? (
        <InlineMessage tone="neutral" live="polite">
          {t("Drawing the avatar. This can take a minute.")}
        </InlineMessage>
      ) : null}
      {failure !== null ? (
        <InlineError retry={{ onRetry: start }}>
          {[t("Avatar generation failed."), failure].filter(Boolean).join(" ")}
        </InlineError>
      ) : null}
    </div>
  );
}
