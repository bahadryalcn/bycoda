import { useRef, useState, useSyncExternalStore } from "react";
import { themePalette } from "../../../../../shared/theme/palette";
import { t, useLocale } from "../../../../../shared/i18n";
import { useColorScheme } from "../../../../../shared/hooks/useColorScheme";
import { ColorPickerPopover } from "../../../../../shared/ui/ColorPickerPopover";
import { Button } from "../../../../../shared/ui/Button";
import { Popover } from "../../../../../shared/ui/Popover";
import {
  INTERACTION_TINT_DEFAULT,
  interactionStepPercent,
  loadInteractionTint,
  saveInteractionTint,
  subscribeInteractionTint,
  type InteractionTintSource,
} from "../../../model/interactionTint";
import { Group, Row, Segmented, Slider } from "../../settingsControls";
import "./ThemeControls.css";

const snapshot = () => JSON.stringify(loadInteractionTint());
const STRENGTH_MIN = 50;
const STRENGTH_MAX = 200;

/**
 * The "Interaction states" topic: which color hover, selected and pressed mix in, how strongly,
 * and a live ladder plus a list to try the result on. One reset restores the whole record.
 */
export function StateLadder() {
  useLocale();
  const value = JSON.parse(
    useSyncExternalStore(subscribeInteractionTint, snapshot, snapshot),
  ) as ReturnType<typeof loadInteractionTint>;
  const light = useColorScheme() === "light";
  const tryItems = [t("Sessions"), t("Chat"), t("Workspace"), t("Terminal")];
  const steps = interactionStepPercent(light, value.strength);
  const [open, setOpen] = useState(false);
  const [tried, setTried] = useState(1);
  const anchor = useRef<HTMLDivElement>(null);
  const update = (change: Partial<typeof value>) => saveInteractionTint({ ...value, ...change });
  const ladder: {
    state: "rest" | "hover" | "selected" | "pressed";
    label: string;
    mix: string;
  }[] = [
    { state: "rest", label: t("Rest"), mix: "—" },
    { state: "hover", label: t("Hover"), mix: `+${steps.hover}%` },
    { state: "selected", label: t("Selected"), mix: `+${steps.selected}%` },
    { state: "pressed", label: t("Pressed"), mix: `+${steps.pressed}%` },
  ];
  return (
    <Group
      title={t("Interaction states")}
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
                className="state-custom-dot"
                style={{ background: value.customColor ?? themePalette.hexA3ACB8 }}
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
        <Slider
          label={t("Interaction strength")}
          value={value.strength}
          display={`${value.strength}%`}
          min={STRENGTH_MIN}
          max={STRENGTH_MAX}
          onChange={(strength) => update({ strength })}
        />
      </Row>
      <Row
        stacked
        label={t("Try it")}
        description={t(
          "The ladder shows each state's mix; the list responds to pointer and keyboard.",
        )}
      >
        <div className="theme-states">
          <div className="theme-state-list" aria-label={t("Interaction states")}>
            {ladder.map((row) => (
              <div key={row.state} className="theme-state-row" data-state={row.state}>
                <span>{row.label}</span>
                <small>{row.mix}</small>
              </div>
            ))}
          </div>
          <div className="theme-try-list" role="group" aria-label={t("Try it")}>
            {tryItems.map((item, index) => (
              <Button
                key={index}
                variant="item"
                selected={tried === index}
                onClick={() => setTried(index)}
              >
                {item}
              </Button>
            ))}
          </div>
        </div>
      </Row>
    </Group>
  );
}
