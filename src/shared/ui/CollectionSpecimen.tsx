import { useState } from "react";
import { ContinuousList } from "./ContinuousList";
import { Button } from "./Button";
import { useT } from "../i18n";

const records = Array.from({ length: 500 }, (_, index) => ({
  id: String(index),
  label: `Record ${index + 1}`,
}));

/** Live bounded-list consumer within the existing controls specimen. */
export function CollectionSpecimen() {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <ContinuousList
      stateKey="control-specimen:collection"
      items={records}
      itemKey={(item) => item.id}
      requiredKey={selected}
      estimateSize={36}
      partial={t("Partial")}
      renderItem={(item) => (
        <Button
          variant="item"
          fullWidth
          selected={selected === item.id}
          onClick={() => setSelected(item.id)}
        >
          {item.label}
        </Button>
      )}
    />
  );
}
