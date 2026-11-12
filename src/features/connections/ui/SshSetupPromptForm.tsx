import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { PasswordField } from "../../../shared/ui/PasswordField";
import type { SshSetup } from "../model/protocol";

/** Answers one SSH setup prompt. Render it with `key={prompt.id}` so a new
 * prompt starts with an empty answer and an enabled form. */
export function SshSetupPromptForm({
  prompt,
  onRespond,
}: {
  prompt: NonNullable<SshSetup["prompt"]>;
  /** Resolves false when the answer was not delivered. */
  onRespond: (value: string) => Promise<boolean>;
}) {
  const [answer, setAnswer] = useState("");
  const [answering, setAnswering] = useState(false);
  const respond = async (value: string) => {
    if (answering) return;
    setAnswering(true);
    if (await onRespond(value)) setAnswer("");
    else setAnswering(false);
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void respond(prompt.confirm ? "yes" : answer);
      }}
    >
      <Text as="p" tone="primary" leading="relaxed" className="whitespace-pre-wrap break-words">
        {prompt.message}
      </Text>
      {!prompt.confirm && (
        <PasswordField
          autoFocus
          label={t("SSH password or passphrase")}
          hideLabel
          aria-label={t("SSH password or passphrase")}
          autoComplete="off"
          disabled={answering}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
        />
      )}
      <div className="flex gap-2">
        <Button disabled={answering} variant="primary" type="submit">
          {prompt.confirm ? t("Trust host and continue") : t("Continue")}
        </Button>
        {prompt.confirm && (
          <Button
            type="button"
            disabled={answering}
            onClick={() => void respond("no")}
            variant="secondary"
          >
            {t("Reject")}
          </Button>
        )}
      </div>
    </form>
  );
}
