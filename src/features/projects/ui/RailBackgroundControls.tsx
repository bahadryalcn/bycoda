import { useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { ColorPickerPopover } from "../../../shared/ui/ColorPickerPopover";
import { Popover } from "../../../shared/ui/Popover";
import { Slider } from "../../../shared/ui/Slider";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { t } from "../../../shared/i18n";
import { type RailBackgrounds, railBackgroundColor } from "../../workspace/model/tabGroups";

function ColorSwatchButton({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (hex: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        iconOnly
        label={label}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span
          aria-hidden="true"
          className="block icon-md rounded-(--ui-radius-control) border border-(--ui-pane-border)"
          style={{ background: value }}
        />
      </Button>
      {open ? (
        <Popover
          anchor={trigger}
          kind="dialog"
          aria-label={label}
          width={232}
          onDismiss={() => setOpen(false)}
        >
          <div className="p-3">
            <ColorPickerPopover value={value} onChange={onChange} />
          </div>
        </Popover>
      ) : null}
    </>
  );
}

export function RailBackgroundControls({
  value,
  color,
  group,
  onChange,
}: {
  value: RailBackgrounds;
  color: string;
  group: boolean;
  onChange: (value: RailBackgrounds) => void;
}) {
  return (
    <details className="rounded-md border border-(--ui-pane-border) text-ui-caption">
      <summary className="cursor-pointer px-2 py-1.5 text-content">
        {t("Background colors")}
      </summary>
      <div className="space-y-2 p-2">
        {(group ? (["header", "body"] as const) : (["header"] as const)).map((part) => {
          const current = value[part];
          const label = t(
            part === "body" ? "Expanded contents" : group ? "Group header" : "Project row",
          );
          const update = (patch: Partial<NonNullable<typeof current>>) =>
            onChange({
              ...value,
              [part]: { color: current?.color ?? color, opacity: current?.opacity ?? 15, ...patch },
            });
          return (
            <div
              key={part}
              className="space-y-1 rounded p-1"
              style={{ background: railBackgroundColor(current) }}
            >
              <div className="flex items-center gap-2">
                <label className="flex flex-1 items-center gap-2">
                  <Checkbox
                    checked={!!current}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        [part]: event.target.checked ? { color, opacity: 15 } : undefined,
                      })
                    }
                  />
                  <span>{label}</span>
                </label>
                <ColorSwatchButton
                  label={`${label}: ${t("Color")}`}
                  value={current?.color ?? color}
                  disabled={!current}
                  onChange={(hex) => update({ color: hex })}
                />
              </div>
              <label className="flex items-center gap-2 text-(--ui-text-muted)">
                <span>{t("Opacity")}</span>
                <Slider
                  hideLabel
                  label={`${label}: ${t("Opacity")}`}
                  min={0}
                  max={100}
                  value={current?.opacity ?? 15}
                  disabled={!current}
                  onValueChange={(next) => update({ opacity: next })}
                  className="min-w-0 flex-1"
                />
                <span className="w-8 text-end">{current?.opacity ?? 15}%</span>
              </label>
            </div>
          );
        })}
      </div>
    </details>
  );
}
