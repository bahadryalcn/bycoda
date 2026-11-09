import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { SearchableSelect } from "../../../../shared/ui/SearchableSelect";
import { Switch } from "../../../../shared/ui/Switch";
import { Row } from "../../../settings/public/settingsControls";
import { useProfileRows } from "./SettingsProfileRow";
import styles from "./schedule.module.css";

const hours = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00`,
}));

/**
 * One hour range on a schedule grid row, shaped like the other switch rows: the switch and its
 * label on the left, then the start and end selects on the right while the range is on. While it
 * is off, the right cell says what that means in muted text ("All day" for work, "Off" for quiet).
 * Equal start and end mean the range is off. Always renders two cells so rows stay aligned.
 * In the settings dialog it is one settings row: the title on the left, the switch and range on the right.
 */
export function ScheduleHours({
  kind,
  start,
  end,
  onChange,
}: {
  kind: "work" | "quiet";
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
}) {
  const rows = useProfileRows();
  const work = kind === "work";
  // The last non-empty range, restored when the range is switched back on.
  const [remembered, setRemembered] = useState(() =>
    start !== end ? { start, end } : work ? { start: 9, end: 17 } : { start: 22, end: 8 },
  );
  if (start !== end && (remembered.start !== start || remembered.end !== end))
    setRemembered({ start, end });
  const enabled = start !== end;
  const [editingRange, setEditingRange] = useState(enabled);
  const showRange = enabled || editingRange;
  const name = work ? t("Work hours") : t("Quiet hours");
  const toggle = (
    <Switch
      {...(rows ? { "aria-label": name } : { label: name })}
      checked={enabled}
      onCheckedChange={(checked) => {
        setEditingRange(checked);
        if (checked) onChange(remembered.start, remembered.end);
        else onChange(start, start);
      }}
    />
  );
  const range = (
    <div className={rows ? styles.rangeRow : styles.range}>
      {showRange ? (
        <>
          <SearchableSelect
            hideLabel
            label={work ? t("Work hours start") : t("Quiet hours start")}
            value={String(start)}
            options={hours}
            onChange={(value) => {
              setEditingRange(true);
              onChange(Number(value), end);
            }}
          />
          <span className={styles.dash} aria-hidden="true">
            –
          </span>
          <SearchableSelect
            hideLabel
            label={work ? t("Work hours end") : t("Quiet hours end")}
            value={String(end)}
            options={hours}
            onChange={(value) => {
              setEditingRange(true);
              onChange(start, Number(value));
            }}
          />
        </>
      ) : (
        <span className={styles.muted}>{work ? t("All day") : t("Off")}</span>
      )}
    </div>
  );
  if (rows)
    return (
      <Row label={name}>
        <div className={styles.hoursControl} data-hours="">
          {range}
          {toggle}
        </div>
      </Row>
    );
  return (
    <>
      <div className={styles.switchCell}>{toggle}</div>
      {range}
    </>
  );
}
