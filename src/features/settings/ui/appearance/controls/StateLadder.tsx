import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { Text } from "../../../../../shared/ui/Text";
import { useRef, useState, useSyncExternalStore } from "react";
import { themePalette } from "../../../../../shared/theme/palette";
import { t, useLocale } from "../../../../../shared/i18n";
import { useColorScheme } from "../../../../../shared/hooks/useColorScheme";
import { ColorPickerPopover } from "../../../../../shared/ui/ColorPickerPopover";
import { Button } from "../../../../../shared/ui/Button";
import { Chatting, Folder, MessageSquare, Terminal } from "../../../../../shared/ui/icons";
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
import "./StateLadder.css";

const snapshot = () => JSON.stringify(loadInteractionTint());
const STRENGTH_MIN = 50;
const STRENGTH_MAX = 200;

/**
 * The "Interaction states" topic: which color hover, selected and pressed mix in, how strongly,
 * and one live list with a row pinned to each state, which also responds to the pointer. One reset restores the whole record.
 */
export function StateLadder() {
  useLocale();
  const value = JSON.parse(
    useSyncExternalStore(subscribeInteractionTint, snapshot, snapshot),
  ) as ReturnType<typeof loadInteractionTint>;
  const light = useColorScheme() === "light";
  const steps = interactionStepPercent(light, value.strength);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const update = (change: Partial<typeof value>) => saveInteractionTint({ ...value, ...change });
  const rows = [
    { state: "rest", Icon: Chatting, item: t("Sessions"), label: t("Rest"), mix: "" },
    {
      state: "hover",
      Icon: MessageSquare,
      item: t("Chat"),
      label: t("Hover"),
      mix: `+${steps.hover}%`,
    },
    {
      state: "selected",
      Icon: Folder,
      item: t("Workspace"),
      label: t("Selected"),
      mix: `+${steps.selected}%`,
    },
    {
      state: "pressed",
      Icon: Terminal,
      item: t("Terminal"),
      label: t("Pressed"),
      mix: `+${steps.pressed}%`,
    },
  ] as const;
  return (
    <Group
      title={t("Interaction states")}
      modified={snapshot() !== JSON.stringify(INTERACTION_TINT_DEFAULT)}
      resetLabel={t("Reset interaction states")}
      onReset={() => saveInteractionTint(INTERACTION_TINT_DEFAULT)}
    >
      <div className="theme-detail-split">
        <div className="theme-detail-controls">
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
                    {...surfaceAttributes({ frame: "stroke", edge: "all" }, "state-custom-dot")}
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
        </div>
        <div className="theme-detail-preview">
          <Row
            stacked
            label={t("Preview")}
            description={t("Each row is pinned to one state. Hover or press any row to feel it.")}
          >
            <ul className="state-preview" aria-label={t("Interaction states")}>
              {rows.map((row) => (
                <Text
                  as="li"
                  size="secondary"
                  tone="inherit"
                  leading="inherit"
                  key={row.state}
                  className="state-preview-row"
                  data-state={row.state}
                >
                  <row.Icon size={14} aria-hidden="true" />
                  <Text
                    as="span"
                    size="inherit"
                    tone="inherit"
                    truncate
                    className="state-preview-name"
                  >
                    {row.item}
                  </Text>
                  <small className="state-preview-badge">
                    <Text as="span" size="caption" tone="secondary" leading="inherit">
                      {row.label}
                      {row.mix ? ` ${row.mix}` : ""}
                    </Text>
                  </small>
                </Text>
              ))}
            </ul>
          </Row>
        </div>
      </div>
    </Group>
  );
}
