import { useState } from "react";
import { Slider } from "../../../../../shared/ui/settings";

/**
 * Settings slider that previews while dragging and persists once on release: the readout follows an
 * in-memory draft, the optional `apply` paints the value live, `commit` writes it. The draft clears
 * on commit and is dropped when the stored value changes underneath it (reset, another window), so
 * the stored value always wins. Omit `apply` when the preview must stay in memory only.
 */
export function DraftSlider({
  value,
  format,
  apply,
  commit,
  ...slider
}: {
  label: string;
  value: number;
  format: (value: number) => string;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  apply?: (value: number) => void;
  commit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<{ base: number; value: number } | null>(null);
  const shown = draft?.base === value ? draft.value : value;
  return (
    <Slider
      {...slider}
      value={shown}
      display={format(shown)}
      onChange={(next) => {
        setDraft({ base: value, value: next });
        apply?.(next);
      }}
      onValueCommit={(next) => {
        setDraft(null);
        commit(next);
      }}
    />
  );
}
