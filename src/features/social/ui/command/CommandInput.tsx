import { t } from "../../../../shared/i18n";
import { DisabledReason } from "../common/DisabledReason";
import { Sparkles } from "../../../../shared/ui/icons";
import { PromptField } from "../../../../shared/ui/PromptField";

export type CommandInputProps = {
  text: string;
  busy: boolean;
  onChange: (text: string) => void;
  onSubmit: () => void;
};

/** The natural-language command composer. One primary action: Plan, inside the frame's footer. */
export function CommandInput({ text, busy, onChange, onSubmit }: CommandInputProps) {
  const empty = text.trim().length === 0;
  return (
    <form
      className="command-input"
      onSubmit={(event) => {
        event.preventDefault();
        if (!empty && !busy) onSubmit();
      }}
    >
      <PromptField
        label={t("Ask AI")}
        value={text}
        maxLength={2000}
        minRows={2}
        maxRows={6}
        placeholder={t("For example: reply to this week's pricing questions")}
        surface="raised"
        onChange={(event) => onChange(event.target.value)}
        toolbarTrailing={
          <DisabledReason
            type="submit"
            variant="primary"
            size="sm"
            startIcon={<Sparkles className="icon-sm" strokeWidth={1.75} aria-hidden />}
            loading={busy}
            {...(empty
              ? { disabled: true as const, reason: t("Type what AI should do.") }
              : { disabled: false as const })}
          >
            {t("Plan")}
          </DisabledReason>
        }
      />
    </form>
  );
}
