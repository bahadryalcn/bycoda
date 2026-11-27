import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { useRef, useState, useSyncExternalStore } from "react";
import { IS_MAC } from "../../../../../platform/tauri/platform";
import { t, useLocale } from "../../../../../shared/i18n";
import { themePalette } from "../../../../../shared/theme/palette";
import { Button } from "../../../../../shared/ui/Button";
import { ColorPickerPopover } from "../../../../../shared/ui/ColorPickerPopover";
import { Popover } from "../../../../../shared/ui/Popover";
import {
  SCROLLBAR_STRENGTH_MAX,
  SCROLLBAR_STRENGTH_MIN,
  SCROLLBAR_STYLE_DEFAULT,
  loadScrollbarStyle,
  saveScrollbarStyle,
  subscribeScrollbarStyle,
  type ScrollbarColor,
  type ScrollbarSize,
  type ScrollbarVisibility,
} from "../../../model/scrollbarStyle";
import { Group, Row, Segmented, Slider } from "../../../../../shared/ui/settings";
import "./ThemeControls.css";

const snapshot = () => JSON.stringify(loadScrollbarStyle());
const DEFAULT_SNAPSHOT = JSON.stringify(SCROLLBAR_STYLE_DEFAULT);

/**
 * "Scrollbars": thickness and visibility for native scrollbars, with color and strength behind
 * Advanced. macOS keeps its system overlay bars, so thickness and visibility are not offered there
 * (color and strength still reach the editor and terminal). The page's own scrollbar is the preview.
 */
export function ScrollbarGroup() {
  useLocale();
  const raw = useSyncExternalStore(subscribeScrollbarStyle, snapshot, snapshot);
  const value = JSON.parse(raw) as ReturnType<typeof loadScrollbarStyle>;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const update = (change: Partial<typeof value>) => saveScrollbarStyle({ ...value, ...change });
  const customColor = value.customColor ?? themePalette.hexA3ACB8;
  return (
    <Group
      title={t("Scrollbars")}
      modified={raw !== DEFAULT_SNAPSHOT}
      resetLabel={t("Reset scrollbars")}
      onReset={() => saveScrollbarStyle(SCROLLBAR_STYLE_DEFAULT)}
    >
      {IS_MAC ? null : (
        <>
          <Row id="scrollbar-size" label={t("Scrollbar size")} stacked>
            <Segmented<ScrollbarSize>
              label={t("Scrollbar size")}
              value={value.size}
              options={[
                { value: "extra-thin", label: t("Extra thin") },
                { value: "thin", label: t("Thin") },
                { value: "medium", label: t("Medium") },
                { value: "large", label: t("Large") },
                { value: "xlarge", label: t("XLarge") },
              ]}
              onChange={(size) => update({ size })}
            />
          </Row>
          <Row
            id="scrollbar-visibility"
            label={t("Show scrollbars")}
            description={t("On hover shows a scrollbar while the pointer is over its area.")}
          >
            <Segmented<ScrollbarVisibility>
              label={t("Show scrollbars")}
              value={value.visibility}
              options={[
                { value: "hover", label: t("On hover") },
                { value: "always", label: t("Always") },
              ]}
              onChange={(visibility) => update({ visibility })}
            />
          </Row>
        </>
      )}
      <Row
        id="scrollbar-color"
        controlWidth="fill"
        label={t("Scrollbar color")}
        description={t("Automatic follows the accent color of your theme.")}
      >
        <div ref={anchor} className="state-ladder-source">
          <Segmented<ScrollbarColor>
            label={t("Scrollbar color")}
            value={value.color}
            options={[
              { value: "auto", label: t("Automatic") },
              { value: "neutral", label: t("Neutral") },
              { value: "theme", label: t("Theme") },
              { value: "custom", label: t("Custom") },
            ]}
            onChange={(color) => {
              update({
                color,
                customColor: color === "custom" ? customColor : value.customColor,
              });
              setOpen(color === "custom");
            }}
          />
          {value.color === "custom" && (
            <Button
              variant="secondary"
              size="sm"
              inset="icon"
              aria-label={t("Custom color")}
              onClick={() => setOpen(true)}
            >
              <span
                {...surfaceAttributes(
                  { frame: "pane", edge: "all", radius: "circle", variant: "user-color" },
                  "state-custom-dot",
                )}
                style={{ "--surface-user-color": customColor } as React.CSSProperties}
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
                value={customColor}
                onChange={(next) => update({ color: "custom", customColor: next })}
              />
            </Popover>
          )}
        </div>
      </Row>
      <Row id="scrollbar-strength" label={t("Scrollbar strength")}>
        <Slider
          label={t("Scrollbar strength")}
          value={value.strength}
          display={`${value.strength}%`}
          min={SCROLLBAR_STRENGTH_MIN}
          max={SCROLLBAR_STRENGTH_MAX}
          step={10}
          onChange={(strength) => update({ strength })}
        />
      </Row>
    </Group>
  );
}
