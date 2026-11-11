import type { ReactNode } from "react";
import { Surface } from "../../../shared/ui/Surface";
import { Meter, type MeterTone } from "../../../shared/ui/Meter";
import { SortableDataTable, type DataColumn } from "../../../shared/ui/SortableDataTable";
import "./sprints.css";

/** A thin-framed figure: caption, heading-size tabular value, optional bounded meter and detail line. */
export function SprintKpi({
  label,
  value,
  detail,
  meter,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  meter?: { value: number; max: number; tone?: MeterTone; valueText: string };
}) {
  return (
    <Surface variant="card" padding="md" className="sprint-kpi">
      <span className="sprint-kpi-label">{label}</span>
      <span className="sprint-kpi-value">{value}</span>
      {meter && meter.max > 0 ? (
        <Meter
          label={label}
          value={meter.value}
          max={meter.max}
          tone={meter.tone ?? "accent"}
          valueText={meter.valueText}
        />
      ) : null}
      {detail ? <span className="sprint-kpi-detail">{detail}</span> : null}
    </Surface>
  );
}

/** A read-only data table (SortableDataTable, source order, no sort) for the sprint report. */
export function SprintDataTable<T extends Record<string, unknown>>({
  caption,
  rows,
  columns,
  rowKey,
}: {
  caption: string;
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: keyof T;
}) {
  return (
    <SortableDataTable
      caption={caption}
      scrollKey={`sprint-report:${caption}`}
      rows={rows}
      columns={columns}
      rowKey={rowKey}
    />
  );
}
