import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { useRef, useState, useSyncExternalStore } from "react";
import { themePalette } from "../../../../../shared/theme/palette";
import { t, useLocale } from "../../../../../shared/i18n";
import { ColorPickerPopover } from "../../../../../shared/ui/ColorPickerPopover";
import { Button } from "../../../../../shared/ui/Button";
import { Popover } from "../../../../../shared/ui/Popover";
import {
  INTERACTION_TINT_DEFAULT,
  applyInteractionTint,
  loadInteractionTint,
  saveInteractionTint,
  subscribeInteractionTint,
  type InteractionTintSource,
} from "../../../model/interactionTint";
import { Group, Row, Segmented } from "../../../../../shared/ui/settings";
import { DraftSlider } from "./ToneSliders";
import "./ThemeControls.css";

const snapshot = () => JSON.stringify(loadInteractionTint());
const STRENGTH_MIN = 50;
const STRENGTH_MAX = 200;

/**
 * The "Interaction" group: which color hover, selected and pressed mix in, and how strongly.
 * The Tone preview above already shows Rest, Hover, Selected and Pressed, so there is no second
 * preview here. Strength previews while dragging and is stored on release. One reset restores
 * the whole record.
 */
export function StateLadder() {
  useLocale();
  const value = JSON.parse(
    useSyncExternalStore(subscribeInteractionTint, snapshot, snapshot),
  ) as ReturnType<typeof loadInteractionTint>;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const update = (change: Partial<typeof value>) => saveInteractionTint({ ...value, ...change });
  return (
    <Group
      title={t("Interaction")}
      modified={snapshot() !== JSON.stringify(INTERACTION_TINT_DEFAULT)}
      resetLabel={t("Reset interaction states")}
      onReset={() => saveInteractionTint(INTERACTION_TINT_DEFAULT)}
    >
      <Row
        id="interaction-tint"
        label={t("Interaction color")}
        description={t("The color that hover, selected and pressed surfaces mix in.")}
      >
        <div ref={anchor} className="state-ladder-source">
          <Segmented<InteractionTintSource>
            label={t("Interaction color")}
            value={value.source}
            options={[
              { value: "neutral", label: t("Neutral") },
              { value: "theme", label: t("Theme") },
              { value: "accent", label: t("Accent") },
              { value: "custom", label: t("Custom") },
            ]}
            onChange={(source) => {
              update({ source });
              setOpen(source === "custom");
            }}
          />
          {value.source === "custom" && (
            <Button
              variant="secondary"
              size="sm"
              inset="icon"
              aria-label={t("Custom color")}
              tooltip={t("Custom color")}
              onClick={() => setOpen(true)}
            >
              <span
                {...surfaceAttributes(
                  { frame: "pane", edge: "all", radius: "circle", variant: "user-color" },
                  "state-custom-dot",
                )}
                style={
                  {
                    "--surface-user-color": value.customColor ?? themePalette.hexA3ACB8,
                  } as React.CSSProperties
                }
              />
            </Button>
          )}
          {open && (
            <Popover
              anchor={anchor}
              side="bottom"
              align="end"
              width={248}
              flow="scroll"
              onDismiss={() => setOpen(false)}
            >
              <ColorPickerPopover
                value={value.customColor ?? themePalette.hexA3ACB8}
                onChange={(customColor) => update({ source: "custom", customColor })}
              />
            </Popover>
          )}
        </div>
      </Row>
      <Row
        id="interaction-strength"
        label={t("Strength")}
        description={t("How far each state moves away from rest.")}
      >
        <DraftSlider
          label={t("Interaction strength")}
          value={value.strength}
          format={(next) => `${next}%`}
          min={STRENGTH_MIN}
          max={STRENGTH_MAX}
          apply={(strength) => applyInteractionTint({ ...value, strength })}
          commit={(strength) => update({ strength })}
        />
      </Row>
    </Group>
  );
}
