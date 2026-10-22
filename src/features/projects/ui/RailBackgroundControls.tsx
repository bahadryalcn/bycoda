import { Slider } from "../../../shared/ui/Slider";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { t } from "../../../shared/i18n";
import { type RailBackgrounds, railBackgroundColor } from "../../workspace/model/tabGroups";

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
    <details className="rounded-md border border-[var(--color-stroke)] text-xs">
      <summary className="cursor-pointer px-2 py-1.5 text-[var(--color-content)]">
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
                <input
                  type="color"
                  aria-label={`${label}: ${t("Color")}`}
                  value={current?.color ?? color}
                  disabled={!current}
                  onChange={(event) => update({ color: event.target.value })}
                  className="h-6 w-8 cursor-pointer rounded border border-[var(--color-stroke)] bg-transparent disabled:opacity-40"
                />
              </div>
              <label className="flex items-center gap-2 text-[var(--ui-text-muted)]">
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
