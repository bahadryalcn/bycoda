import { useContext, useId, useState, type ReactNode } from "react";
import { Button } from "../../../../../shared/ui/Button";
import { ChevronRight } from "../../../../../shared/ui/icons";
import { RevealedSetting, settingDomId, Toggle } from "../../settingsControls";
import styles from "./LayerStack.module.css";

export type BackgroundLayer = {
  id: string;
  name: string;
  /** One short muted line under the name. */
  description?: string;
  enabled: boolean;
  /** Dims the row and its thumbnail; the switch keeps showing `enabled`. Defaults to `!enabled`. */
  dimmed?: boolean;
  /** Without a handler the switch shows the state and is disabled. */
  onToggle?: () => void;
  toggleLabel?: string;
  thumbnail?: ReactNode;
  strength?: ReactNode;
  settingIds?: readonly string[];
  /** IDs not already provided by an editor; these remain on the visible row. */
  anchorIds?: readonly string[];
  content: ReactNode;
};

/** One open editor at a time; editors stay mounted to preserve drafts and operations. */
export function LayerStack({
  layers,
  label,
  description,
}: {
  layers: readonly BackgroundLayer[];
  label: string;
  description: string;
}) {
  const revealed = useContext(RevealedSetting);
  const target = layers.find(
    (layer) => layer.id === revealed || layer.settingIds?.includes(revealed ?? ""),
  );
  const [open, setOpen] = useState<string | null>(target?.id ?? null);
  const [lastReveal, setLastReveal] = useState(revealed);
  if (lastReveal !== revealed) {
    setLastReveal(revealed);
    if (target) setOpen(target.id);
  }
  return (
    <ul className={styles.stack} aria-label={`${label}. ${description}`}>
      {[...layers].reverse().map((layer) => (
        <LayerRow
          key={layer.id}
          layer={layer}
          open={open === layer.id}
          onOpen={() => setOpen(open === layer.id ? null : layer.id)}
        />
      ))}
    </ul>
  );
}

/** A card per layer: the row body toggles the editor, the switch only switches the layer. */
function LayerRow({
  layer,
  open,
  onOpen,
}: {
  layer: BackgroundLayer;
  open: boolean;
  onOpen: () => void;
}) {
  const contentId = useId();
  return (
    <li
      className={styles.layer}
      data-disabled={(layer.dimmed ?? !layer.enabled) || undefined}
      data-open={open || undefined}
    >
      {layer.anchorIds?.map((id) => (
        <span key={id} id={settingDomId(id)} data-setting-id={id} tabIndex={-1} />
      ))}
      <div className={styles.row}>
        <Button
          variant="ghost"
          size="sm"
          align="start"
          fullWidth
          motion="none"
          className={styles.disclosure}
          aria-expanded={open}
          aria-controls={contentId}
          onClick={onOpen}
        >
          <span className={styles.disclosureContent}>
            <span className={styles.thumbnail} aria-hidden>
              {layer.thumbnail}
            </span>
            <span className={styles.text}>
              <span className={styles.name}>{layer.name}</span>
              {layer.description ? (
                <span className={styles.description}>{layer.description}</span>
              ) : null}
            </span>
            <span className={styles.strength}>{layer.strength}</span>
            <ChevronRight aria-hidden className={styles.chevron} data-open={open || undefined} />
          </span>
        </Button>
        <span className={styles.toggle}>
          <Toggle
            label={layer.toggleLabel ?? layer.name}
            on={layer.enabled}
            disabled={!layer.onToggle}
            onChange={() => layer.onToggle?.()}
          />
        </span>
      </div>
      <div id={contentId} className={styles.content} hidden={!open} inert={!open}>
        {layer.content}
      </div>
    </li>
  );
}
