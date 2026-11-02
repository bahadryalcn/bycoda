import { useId, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { ColorPickerPopover } from "../../../shared/ui/ColorPickerPopover";
import { Popover } from "../../../shared/ui/Popover";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Slider } from "../../../shared/ui/Slider";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { t } from "../../../shared/i18n";
import type { RailBackgrounds } from "../../workspace/model/tabGroups";

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
        // Rendered inside the appearance popover, so the overlay stack treats it as a child:
        // picking a colour does not dismiss the menu it belongs to.
        <Popover
          anchor={trigger}
          kind="dialog"
          side="right"
          align="start"
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
  const regionId = useId();
  const parts = group ? (["header", "body"] as const) : (["header"] as const);
  const [expanded, setExpanded] = useState(() => parts.some((part) => !!value[part]));
  return (
    <div>
      <SectionLabel
        as="div"
        collapsible
        expanded={expanded}
        onExpandedChange={setExpanded}
        controls={regionId}
        count={parts.filter((part) => !!value[part]).length || null}
      >
        {t("Background colors")}
      </SectionLabel>
      {expanded ? (
        <div id={regionId} className="mt-1 space-y-1">
          {parts.map((part) => {
            const current = value[part];
            const label = t(
              part === "body" ? "Expanded contents" : group ? "Group header" : "Project row",
            );
            const opacity = current?.opacity ?? 15;
            const update = (patch: Partial<NonNullable<typeof current>>) =>
              onChange({
                ...value,
                [part]: { color: current?.color ?? color, opacity, ...patch },
              });
            return (
              <div
                key={part}
                className="rounded-(--ui-radius-control) bg-(--ui-surface-raised) px-2 py-1.5"
              >
                <div className="flex min-h-7 items-center gap-2">
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-ui-secondary">
                    <Checkbox
                      checked={!!current}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          [part]: event.target.checked ? { color, opacity: 15 } : undefined,
                        })
                      }
                    />
                    <span className="truncate">{label}</span>
                  </label>
                  <ColorSwatchButton
                    label={`${label}: ${t("Color")}`}
                    value={current?.color ?? color}
                    disabled={!current}
                    onChange={(hex) => update({ color: hex })}
                  />
                </div>
                {current ? (
                  <div className="flex items-center gap-2 text-ui-caption text-(--ui-text-muted)">
                    <span className="shrink-0">{t("Opacity")}</span>
                    <Slider
                      hideLabel
                      label={`${label}: ${t("Opacity")}`}
                      min={0}
                      max={100}
                      value={opacity}
                      onValueChange={(next) => update({ opacity: next })}
                      className="min-w-0 flex-1"
                    />
                    <span className="w-9 shrink-0 text-end tabular-nums">{opacity}%</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
