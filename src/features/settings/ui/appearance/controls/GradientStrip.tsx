import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { ColorPickerPopover } from "../../../../../shared/ui/ColorPickerPopover";
import { Popover } from "../../../../../shared/ui/Popover";
import { Text } from "../../../../../shared/ui/Text";
import { SegmentedControl } from "../../../../../shared/ui/SegmentedControl";
import { workspaceBackgroundImage } from "../../../../../shared/theme/workspaceBackground";
import {
  WORKSPACE_BACKGROUND_PRESETS,
  type WorkspaceBackground,
} from "../../../model/workspaceBackground";
import { backgroundGradientChange } from "../../../model/backgroundGradient";
import { Row, Slider } from "../../settingsControls";
import { AngleDial } from "./AngleDial";
import { BackgroundGenerator } from "./BackgroundGenerator";
import { generatorSession } from "./themeGeneratorSession";
import styles from "./GradientStrip.module.css";

function ColorStop({
  index,
  color,
  onChange,
}: {
  index: number;
  color: string;
  onChange: (color: string) => void;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const label = t("Color {p0}", { p0: index + 1 });
  return (
    <div
      ref={anchor}
      className={styles.stop}
      style={{ "--stop-position": `${index * 46 + 4}%` } as React.CSSProperties}
    >
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        label={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span
          {...surfaceAttributes(
            { frame: "content-strong", radius: "circle", variant: "user-color" },
            styles.stopDot,
          )}
          style={{ "--surface-user-color": color } as React.CSSProperties}
          aria-hidden
        />
      </Button>
      {open && (
        <Popover
          anchor={anchor}
          side="bottom"
          align="end"
          width={248}
          flow="scroll"
          onDismiss={() => setOpen(false)}
          className="px-2 pb-2"
        >
          <ColorPickerPopover value={color} onChange={onChange} />
        </Popover>
      )}
    </div>
  );
}

export function GradientStrip({
  value,
  onChange,
}: {
  value: WorkspaceBackground;
  onChange: (change: Partial<WorkspaceBackground>) => void;
}) {
  const pending = useRef<Partial<WorkspaceBackground>>({});
  const frame = useRef<number | null>(null);
  const latestChange = useRef(onChange);
  useLayoutEffect(() => {
    latestChange.current = onChange;
  });
  const update = (change: Partial<WorkspaceBackground>) => {
    pending.current = { ...pending.current, ...change };
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const next = pending.current;
      pending.current = {};
      latestChange.current(next);
    });
  };
  const edit = (change: Partial<WorkspaceBackground>) => {
    generatorSession.invalidateImageIntent();
    update(change);
  };
  useEffect(
    () => () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        latestChange.current(pending.current);
      }
    },
    [],
  );
  const angleLocked = value.style !== "linear";
  return (
    <div className={styles.editor}>
      <div
        {...surfaceAttributes({ radius: "card", frame: "pane", edge: "all" }, styles.gradient)}
        style={{ "--gradient-image": workspaceBackgroundImage(value) } as React.CSSProperties}
      >
        {value.colors.map((color, index) => (
          <ColorStop
            key={index}
            index={index}
            color={color}
            onChange={(next) => {
              const colors: [string, string, string] = [...value.colors];
              colors[index] = next;
              edit({ colors });
            }}
          />
        ))}
      </div>
      <div className={styles.controlRow}>
        <div className={styles.typeGroup}>
          <Text as="span" tone="muted" leading="inherit" className={styles.label}>
            {t("Type")}
          </Text>
          <SegmentedControl
            label={t("Gradient type")}
            value={value.style}
            options={[
              { value: "linear", label: t("Linear") },
              { value: "radial", label: t("Radial") },
              { value: "solid", label: t("Solid") },
            ]}
            onValueChange={(style) => edit({ style: style as WorkspaceBackground["style"] })}
          />
        </div>
        <div className={styles.angleGroup}>
          <Text as="span" tone="muted" leading="inherit" className={styles.label}>
            {t("Angle")}
          </Text>
          <div className={styles.dialOnly}>
            <AngleDial
              value={value.angle}
              disabled={angleLocked}
              onChange={(angle) => edit({ angle })}
            />
          </div>
          <Slider
            label={t("Gradient angle slider")}
            value={value.angle}
            display={`${value.angle}°`}
            min={0}
            max={360}
            onChange={(angle) => edit({ angle })}
            disabled={angleLocked}
          />
        </div>
      </div>
      <div className={styles.presetRow}>
        <Text as="span" tone="muted" leading="inherit" className={styles.label}>
          {t("Presets")}
        </Text>
        <div className={styles.presets} aria-label={t("Background preset")}>
          {WORKSPACE_BACKGROUND_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              variant="secondary"
              size="sm"
              shape="pill"
              startIcon={
                <span
                  {...surfaceAttributes({ radius: "circle", frame: "pane" }, styles.presetDot)}
                  style={
                    {
                      "--gradient-image": `linear-gradient(135deg, ${preset.value.colors[0]}, ${preset.value.colors[1]})`,
                    } as React.CSSProperties
                  }
                  aria-hidden
                />
              }
              onClick={() => {
                const { style, colors, angle, strength } = preset.value;
                edit({ enabled: true, style, colors, angle, strength });
              }}
            >
              {t(preset.label)}
            </Button>
          ))}
        </div>
      </div>
      <BackgroundGenerator
        onGenerated={(suggestion) => update(backgroundGradientChange(suggestion))}
      />
      <Row label={t("Strength")} description={t("How strongly the color shows through.")}>
        <Slider
          label={t("Background strength")}
          value={value.strength}
          display={`${value.strength}%`}
          min={0}
          max={100}
          onChange={(strength) => edit({ strength })}
        />
      </Row>
    </div>
  );
}
