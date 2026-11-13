import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { useRef, useState, useSyncExternalStore } from "react";
import { themePalette } from "../../../../../shared/theme/palette";
import { t, useLocale } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { ColorPickerPopover } from "../../../../../shared/ui/ColorPickerPopover";
import { Popover } from "../../../../../shared/ui/Popover";
import { Text } from "../../../../../shared/ui/Text";
import { WorkingIndicator } from "../../../../../shared/ui/WorkingIndicator";
import {
  WORKING_INDICATOR_DEFAULT,
  WORKING_INDICATOR_STRENGTH_MAX,
  WORKING_INDICATOR_STRENGTH_MIN,
  loadWorkingIndicator,
  saveWorkingIndicator,
  subscribeWorkingIndicator,
  type WorkingIndicatorColor,
  type WorkingIndicatorStyle,
} from "../../../model/workingIndicator";
import { Group, Row, Segmented, Slider } from "../../settingsControls";
import "./ThemeControls.css";

const snapshot = () => JSON.stringify(loadWorkingIndicator());

/**
 * "Working projects": the color, pulse and strength of the decoration a project row shows while an
 * agent works. The preview is a real working row (`data-project-row` + `data-project-working`), so it
 * follows the same rules as the rail, including reduced and decorative motion.
 */
export function WorkingIndicatorGroup() {
  useLocale();
  const value = JSON.parse(
    useSyncExternalStore(subscribeWorkingIndicator, snapshot, snapshot),
  ) as ReturnType<typeof loadWorkingIndicator>;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const update = (change: Partial<typeof value>) => saveWorkingIndicator({ ...value, ...change });
  const customColor = value.customColor ?? themePalette.active;
  return (
    <Group
      title={t("Working projects")}
      description={t("How a project row looks while an agent works in it.")}
      modified={snapshot() !== JSON.stringify(WORKING_INDICATOR_DEFAULT)}
      resetLabel={t("Reset working projects")}
      onReset={() => saveWorkingIndicator(WORKING_INDICATOR_DEFAULT)}
    >
      <Row
        id="working-indicator-color"
        label={t("Working color")}
        description={t("Automatic follows the accent color of your theme.")}
      >
        <div ref={anchor} className="state-ladder-source">
          <Segmented<WorkingIndicatorColor>
            label={t("Working color")}
            value={value.color}
            options={[
              { value: "auto", label: t("Automatic") },
              { value: "theme", label: t("Theme") },
              { value: "custom", label: t("Custom") },
            ]}
            onChange={(color) => {
              update({ color, customColor: color === "custom" ? customColor : value.customColor });
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
        id="working-indicator-style"
        label={t("Working animation")}
        description={t("Steady keeps the tint without the pulse; Off leaves only the spinner.")}
      >
        <Segmented<WorkingIndicatorStyle>
          label={t("Working animation")}
          value={value.style}
          options={[
            { value: "pulse", label: t("Pulse") },
            { value: "steady", label: t("Steady") },
            { value: "off", label: t("Off") },
          ]}
          onChange={(style) => update({ style })}
        />
      </Row>
      <Row id="working-indicator-strength" label={t("Working strength")}>
        <Slider
          label={t("Working strength")}
          value={value.strength}
          display={`${value.strength}%`}
          min={WORKING_INDICATOR_STRENGTH_MIN}
          max={WORKING_INDICATOR_STRENGTH_MAX}
          step={10}
          disabled={value.style === "off"}
          onChange={(strength) => update({ strength })}
        />
      </Row>
      <Row stacked label={t("Preview")}>
        <Text
          as="div"
          size="inherit"
          tone="primary"
          aria-hidden="true"
          data-project-row=""
          data-project-working="true"
          {...surfaceAttributes(
            { radius: "row" },
            "relative flex h-(--ui-control-height-compact) w-56 max-w-full items-center gap-2 px-2",
          )}
        >
          <WorkingIndicator size="xs" />
          <Text as="span" size="inherit" tone="inherit" truncate>
            {t("Project")}
          </Text>
        </Text>
      </Row>
    </Group>
  );
}
