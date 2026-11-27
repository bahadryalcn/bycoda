import { StatusBadge, type BadgeStatus } from "../../../../../shared/ui/Badge";
import { ActivityHeatmap } from "../../../../../shared/ui/Charts";
import { ClampText } from "../../../../../shared/ui/ClampText";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { JsonViewer } from "../../../../../shared/ui/JsonViewer";
import { Link } from "../../../../../shared/ui/Link";
import { ShortcutKeys } from "../../../../../shared/ui/ShortcutKbd";
import { StepStrip, type StepStripCell } from "../../../../../shared/ui/StepStrip";
import { Text } from "../../../../../shared/ui/Text";
import { Timeline } from "../../../../../shared/ui/Timeline";
import { UsageMeter } from "../../../../../shared/ui/UsageMeter";
import { presentedView, type PresentedView } from "./presentedContext";

type Tone = "neutral" | "accent" | "info" | "success" | "warning" | "danger";

/** Records and richer displays. Every string comes from the model and is drawn as plain text. */
export const presentedRecordViews: Record<string, PresentedView> = {
  FieldGroup: presentedView<{
    legend: string;
    description?: string;
    layout?: "stack" | "row";
  }>(({ legend, description, layout, children }) => (
    <FieldGroup legend={legend} description={description} descriptionVisible layout={layout}>
      {children}
    </FieldGroup>
  )),

  Timeline: presentedView<{
    label: string;
    events: {
      at: string;
      title: string;
      actor?: string;
      meta?: string;
      detail?: string;
      tone?: "neutral" | "success" | "danger";
    }[];
  }>(({ label, events }) => (
    <Timeline
      label={label}
      events={events.map(({ detail, ...event }, index) => ({
        ...event,
        id: String(index),
        detail: detail && (
          <Text as="p" tone="secondary" className="whitespace-pre-wrap">
            {detail}
          </Text>
        ),
      }))}
    />
  )),
  StepStrip: presentedView<{ label: string; steps: StepStripCell[] }>(({ label, steps }) => (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <Text as="span">{label}</Text>
      <StepStrip cells={steps} capacity={Math.max(8, steps.length)} />
    </div>
  )),
  UsageMeter: presentedView<{
    label: string;
    limit: number;
    segments: { label: string; value: number }[];
    unit?: string;
    valueText?: string;
    tone?: Tone;
  }>(({ label, limit, segments, unit, valueText, tone }) => (
    // The meter's legend and the heatmap's scroller bleed 6px past their box for hover and focus
    // rings, so each sits in 6px of room instead of widening the answer.
    <div className="min-w-0 px-1.5">
      <UsageMeter
        label={label}
        limit={limit}
        unit={unit}
        valueText={valueText}
        tone={tone}
        segments={segments.map((segment, index) => ({ id: String(index), ...segment }))}
      />
    </div>
  )),
  ActivityHeatmap: presentedView<{
    label: string;
    period: string;
    unit: { one: string; other: string };
    days: { date: string; count: number }[];
  }>(({ label, period, unit, days }) => (
    <div className="min-w-0 px-1.5">
      <ActivityHeatmap
        label={label}
        period={period}
        unit={unit}
        days={[...days].sort((a, b) => a.date.localeCompare(b.date))}
      />
    </div>
  )),
  JsonViewer: presentedView<{ label: string; data: unknown }>(({ label, data }) => (
    <JsonViewer label={label} data={data} maxHeight={280} />
  )),

  StatusBadge: presentedView<{ status: BadgeStatus; text?: string }>(({ status, text }) => (
    <StatusBadge status={status}>{text}</StatusBadge>
  )),
  Link: presentedView<{ label: string; url: string }>(({ label, url }) => {
    const address = new URL(url);
    return (
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <Link href={address.href}>{label}</Link>{" "}
        <Text as="span" size="caption" tone="muted">
          {address.hostname}
        </Text>
      </span>
    );
  }),
  ShortcutKeys: presentedView<{ keys: string }>(({ keys }) => <ShortcutKeys shortcut={keys} />),
  ClampText: presentedView<{ text: string; lines?: number }>(({ text, lines }) => (
    <ClampText lines={lines} tone="secondary" className="whitespace-pre-wrap">
      {text}
    </ClampText>
  )),
};
