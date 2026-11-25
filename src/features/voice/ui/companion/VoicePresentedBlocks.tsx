import { useId } from "react";
import { useT } from "../../../../shared/i18n";
import { CopyButton } from "../../../../shared/ui/CopyButton";
import { OutputBlock } from "../../../../shared/ui/OutputBlock";
import { Text } from "../../../../shared/ui/Text";

/** Text the owner asked to take away: shown exactly as sent, copied through the shared clipboard. */
export function PresentedCopyBlock({ label, text }: { label: string; text: string }) {
  const t = useT();
  const labelId = useId();
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Text id={labelId} as="span" tone="secondary" lines={1}>
          {label}
        </Text>
        <CopyButton
          label={t("Copy")}
          text={text}
          size="sm"
          resetKeys={[text]}
          errorDetail
          aria-describedby={labelId}
        />
      </div>
      <OutputBlock frame="filled" face="sans" size="secondary" scroll className="max-h-72 p-2">
        {text}
      </OutputBlock>
    </div>
  );
}
