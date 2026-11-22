import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { OutputBlock } from "../../../../shared/ui/OutputBlock";
import { Select } from "../../../../shared/ui/Select";
import { Text } from "../../../../shared/ui/Text";
import styles from "../VoiceCompanion.module.css";

type Result = { id: string; title: string; status: string; output: string };

function ComparisonSide({
  label,
  result,
  options,
  select,
}: {
  label: string;
  result: Result;
  options: Result[];
  select: (id: string) => void;
}) {
  return (
    <div className={styles.liveWorkDetail}>
      <Select
        label={label}
        value={result.id}
        options={options.map(({ id, title }) => ({ value: id, label: title }))}
        onValueChange={select}
      />
      <Text tone="secondary">{result.status}</Text>
      {result.output && <OutputBlock frame="filled">{result.output}</OutputBlock>}
    </div>
  );
}

/** Compare two retained outputs by exact row identity. */
export function VoiceWorkComparison({ results }: { results: Result[] }) {
  const [first, setFirst] = useState<string | undefined>(results[0]?.id);
  const [second, setSecond] = useState<string | undefined>(results[1]?.id);
  const left = results.find((item) => item.id === first) ?? results[0];
  const rightOptions = results.filter((item) => item.id !== left?.id);
  const right = rightOptions.find((item) => item.id === second) ?? rightOptions[0];
  if (!left || !right) return <Text tone="secondary">{t("No results")}</Text>;
  return (
    <div className={styles.liveWorkCompare}>
      <ComparisonSide
        label={t("First")}
        result={left}
        options={results.filter((item) => item.id !== right.id)}
        select={setFirst}
      />
      <ComparisonSide
        label={t("Second")}
        result={right}
        options={rightOptions}
        select={setSecond}
      />
    </div>
  );
}
