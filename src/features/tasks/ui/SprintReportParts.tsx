import { Progress } from "../../../shared/ui/Progress";
import { Text } from "../../../shared/ui/Text";
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
  meter?: { kind?: "capacity"; value: number; max: number; tone?: MeterTone; valueText: string };
}) {
  const Measure = meter?.kind === "capacity" ? Meter : Progress;
  return (
    <Surface variant="card" padding="md" className="sprint-kpi">
      <Text tone="secondary" size="caption" leading="inherit" className="sprint-kpi-label">
        {label}
      </Text>
      <Text
        as="span"
        size="heading"
        tone="inherit"
        weight="medium"
        leading="tight"
        className="sprint-kpi-value"
      >
        {value}
      </Text>
      {meter && meter.max > 0 ? (
        <Measure
          aria-label={label}
          value={meter.value}
          max={meter.max}
          tone={meter.tone ?? "accent"}
          aria-valuetext={meter.valueText}
        />
      ) : null}
      {detail ? (
        <Text tone="danger" size="caption" leading="inherit" className="sprint-kpi-detail">
          {detail}
        </Text>
      ) : null}
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
