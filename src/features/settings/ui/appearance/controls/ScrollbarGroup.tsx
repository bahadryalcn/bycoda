import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { Text } from "../../../../../shared/ui/Text";
import { useRef, useState, useSyncExternalStore } from "react";
import { IS_MAC } from "../../../../../platform/tauri/platform";
import { formatNumber, t, useLocale } from "../../../../../shared/i18n";
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
import { Group, Row, Segmented, Slider } from "../../settingsControls";
import "./ThemeControls.css";

const PREVIEW_ROWS = [
  'import { useState } from "react";',
  "",
  "export function Counter() {",
  "  const [count, setCount] = useState(0);",
  "  const increment = () => setCount(count + 1);",
  "  const label = `Clicked ${count} times`;",
  "  return { count, increment, label };",
  "}",
  "",
  'export const LABEL = "Scrollbar preview";',
];

const snapshot = () => JSON.stringify(loadScrollbarStyle());

/**
 * "Scrollbars": thumb color, thickness, visibility and strength for native scrollbars, the editor
 * rail and the terminal. macOS keeps its system overlay bars, so thickness and visibility apply
 * only on Windows and Linux; color and strength still reach the editor and terminal there.
 */
export function ScrollbarGroup() {
  useLocale();
  const value = JSON.parse(
    useSyncExternalStore(subscribeScrollbarStyle, snapshot, snapshot),
  ) as ReturnType<typeof loadScrollbarStyle>;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const update = (change: Partial<typeof value>) => saveScrollbarStyle({ ...value, ...change });
  const customColor = value.customColor ?? themePalette.hexA3ACB8;
  const systemBars = t("macOS uses its own scrollbars here.");
  return (
    <Group
      title={t("Scrollbars")}
      modified={snapshot() !== JSON.stringify(SCROLLBAR_STYLE_DEFAULT)}
      resetLabel={t("Reset scrollbars")}
      onReset={() => saveScrollbarStyle(SCROLLBAR_STYLE_DEFAULT)}
    >
      <div className="interface-scrollbar-layout">
        <div {...surfaceAttributes({ layout: "settings-rows" }, "interface-scrollbar-controls")}>
          <Row
            id="scrollbar-color"
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
                      { frame: "stroke", edge: "all", radius: "circle", variant: "user-color" },
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
          <Row
            id="scrollbar-size"
            label={t("Scrollbar size")}
            disabled={IS_MAC}
            disabledReason={systemBars}
          >
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
            disabled={IS_MAC}
            disabledReason={systemBars}
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
        </div>
        <div
          {...surfaceAttributes(
            { frame: "settings", edge: "inline-start" },
            "interface-scrollbar-sample",
          )}
        >
          <Row stacked label={t("Preview")}>
            <div data-scrollbar-preview aria-hidden="true" className="scrollbar-preview">
              {PREVIEW_ROWS.map((row, index) => (
                <div key={row} className="scrollbar-preview-row">
                  <Text
                    size="inherit"
                    tone="muted"
                    leading="inherit"
                    className="scrollbar-preview-gutter"
                  >
                    {formatNumber(index + 1)}
                  </Text>
                  <span>{row}</span>
                </div>
              ))}
            </div>
          </Row>
        </div>
      </div>
    </Group>
  );
}
