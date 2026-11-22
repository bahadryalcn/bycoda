import { useT } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { CopyButton } from "../../../../shared/ui/CopyButton";
import { Text } from "../../../../shared/ui/Text";
import { TextareaField } from "../../../../shared/ui/TextareaField";

type VoiceWorkDraftEvidence = {
  title: string;
  status?: string;
  output?: string;
};

export function VoiceWorkDraft({
  draft,
  onDraftChange,
  evidence,
}: {
  draft: string;
  onDraftChange: (draft: string) => void;
  evidence?: VoiceWorkDraftEvidence;
}) {
  const t = useT();
  function insertEvidence() {
    if (!evidence) return;
    const lines = [evidence.title];
    if (evidence.status) lines.push(`${t("Status")} · ${evidence.status}`);
    if (evidence.output) lines.push("", t("Output"), evidence.output);
    const text = lines.join("\n");
    onDraftChange(draft ? `${draft}\n\n${text}` : text);
  }

  return (
    <div className="grid min-w-0 gap-3">
      {evidence && (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <Text as="span" tone="secondary" truncate>
            {evidence.title}
          </Text>
          <Button variant="ghost" onClick={insertEvidence}>
            {t("Insert")}
          </Button>
        </div>
      )}
      <TextareaField
        label={t("Draft")}
        value={draft}
        minRows={6}
        maxRows={16}
        autosize
        onChange={(event) => onDraftChange(event.currentTarget.value)}
      />
      <div className="justify-self-end">
        <CopyButton label={t("Copy")} text={draft} disabled={!draft.trim()} resetKeys={[draft]} />
      </div>
    </div>
  );
}
