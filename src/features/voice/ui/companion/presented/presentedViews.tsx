import { useState } from "react";
import { formatNumber, useT } from "../../../../../shared/i18n";
import { Alert } from "../../../../../shared/ui/Alert";
import { Badge } from "../../../../../shared/ui/Badge";
import { BadgeList } from "../../../../../shared/ui/BadgeList";
import { BarChart, DonutChart, LineChart } from "../../../../../shared/ui/Charts";
import { Code } from "../../../../../shared/ui/Code";
import { DescriptionItem, DescriptionList } from "../../../../../shared/ui/DescriptionList";
import { DiffStat } from "../../../../../shared/ui/DiffStat";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { Divider } from "../../../../../shared/ui/Divider";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { Heading } from "../../../../../shared/ui/Heading";
import { Meter } from "../../../../../shared/ui/Meter";
import { Progress } from "../../../../../shared/ui/Progress";
import { SortableDataTable } from "../../../../../shared/ui/SortableDataTable";
import { StatRow, StatTile } from "../../../../../shared/ui/StatTile";
import { StatusText } from "../../../../../shared/ui/StatusText";
import { Surface } from "../../../../../shared/ui/Surface";
import { TabList, TabPanel, Tabs } from "../../../../../shared/ui/Tabs";
import { Text } from "../../../../../shared/ui/Text";
import { Timestamp } from "../../../../../shared/ui/Timestamp";
import { PresentedCopyBlock } from "../VoicePresentedBlocks";
import { presentedView, type PresentedView } from "./presentedContext";

const gaps = { sm: "gap-2", md: "gap-3", lg: "gap-5" } as const;
const aligns = { start: "items-start", center: "items-center", end: "items-end" } as const;
const gridColumns = {
  1: "grid-cols-1",
  2: "grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))]",
  3: "grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))]",
  4: "grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))]",
} as const;

type Gap = keyof typeof gaps;
type Align = keyof typeof aligns;
type Columns = keyof typeof gridColumns;

const chartData = (items: { label: string; value: number }[]) =>
  items.map((item, index) => ({ key: String(index), ...item }));

/** Components drawn from plain data: layout, text, feedback and data. */
export const presentedViews: Record<string, PresentedView> = {
  Stack: presentedView<{ direction?: "column" | "row"; gap?: Gap; align?: Align }>(
    ({ direction = "column", gap = "md", align, children }) => (
      <div
        className={`flex min-w-0 ${direction === "row" ? "flex-row flex-wrap items-center" : "flex-col"} ${gaps[gap]} ${align ? aligns[align] : ""}`}
      >
        {children}
      </div>
    ),
  ),
  Grid: presentedView<{ columns?: Columns; gap?: Gap }>(({ columns = 2, gap = "md", children }) => (
    <div className={`grid min-w-0 ${gridColumns[columns]} ${gaps[gap]}`}>{children}</div>
  )),
  Card: presentedView<{ title?: string }>(({ title, children }) => (
    <Surface variant="card" padding="md" as="section" aria-label={title} className="grid gap-3">
      {title && (
        <Heading as="h3" size="item">
          {title}
        </Heading>
      )}
      {children}
    </Surface>
  )),
  Section: presentedView<{ title: string; description?: string }>(
    ({ title, description, children }) => (
      <section aria-label={title} className="grid min-w-0 gap-2">
        <Heading as="h3" size="heading">
          {title}
        </Heading>
        {description && (
          <Text as="p" tone="secondary">
            {description}
          </Text>
        )}
        {children}
      </section>
    ),
  ),
  Disclosure: presentedView<{ summary: string; open?: boolean }>(({ summary, open, children }) => (
    <Disclosure summary={summary} defaultOpen={open} variant="card">
      <div className="grid gap-3">{children}</div>
    </Disclosure>
  )),
  Divider: presentedView<{ label?: string }>(({ label }) => <Divider label={label} />),
  Tabs: presentedView(function TabsView({ nodes = [], renderNode }) {
    const t = useT();
    const tabs = nodes.map((node, index) => ({
      value: `tab${index}`,
      label: String(node.props?.label ?? ""),
      node,
    }));
    const [selected, setSelected] = useState("tab0");
    return (
      <Tabs value={selected} onValueChange={setSelected}>
        <TabList label={t("Tabs")} items={tabs.map(({ value, label }) => ({ value, label }))} />
        {tabs.map(({ value, node }) => (
          <TabPanel key={value} value={value}>
            {renderNode?.(node)}
          </TabPanel>
        ))}
      </Tabs>
    );
  }),
  Tab: presentedView(({ children }) => <div className="grid min-w-0 gap-3 pt-3">{children}</div>),

  Heading: presentedView<{ text: string; size?: "section" | "item" | "heading" }>(
    ({ text, size = "item" }) => (
      <Heading as="h3" size={size}>
        {text}
      </Heading>
    ),
  ),
  Text: presentedView<{
    text: string;
    tone?: "primary" | "secondary" | "muted";
    size?: "caption" | "body";
  }>(({ text, tone, size }) => (
    <Text as="p" tone={tone} size={size} className="whitespace-pre-wrap">
      {text}
    </Text>
  )),
  List: presentedView<{ items: string[]; ordered?: boolean }>(({ items, ordered }) => {
    const List = ordered ? "ol" : "ul";
    return (
      <List className={`grid gap-1.5 ps-5 ${ordered ? "list-decimal" : "list-disc"}`}>
        {items.map((item, index) => (
          <Text key={index} as="li">
            {item}
          </Text>
        ))}
      </List>
    );
  }),
  Code: presentedView<{ text: string; block?: boolean }>(({ text, block }) => (
    <Code variant={block ? "block" : "chip"}>{text}</Code>
  )),
  CopyBlock: presentedView<{ label: string; text: string }>(({ label, text }) => (
    <PresentedCopyBlock label={label} text={text} />
  )),
  DiffStat: presentedView<{ additions: number; deletions: number }>((props) => (
    <DiffStat {...props} showZero />
  )),
  Timestamp: presentedView<{ value: string; format?: "auto" | "relative" | "time" | "date" }>(
    ({ value, format }) => <Timestamp value={Date.parse(value)} format={format} />,
  ),

  Alert: presentedView<{
    tone?: "info" | "success" | "warning" | "danger";
    title?: string;
    text: string;
  }>(({ tone, title, text }) => (
    <Alert tone={tone} title={title}>
      {text}
    </Alert>
  )),
  Badge: presentedView<{
    text: string;
    tone?: "neutral" | "accent" | "info" | "success" | "warning" | "danger";
  }>(({ text, tone }) => <Badge tone={tone}>{text}</Badge>),
  BadgeList: presentedView<{ label: string; items: string[] }>(({ label, items }) => (
    <BadgeList
      label={label}
      items={items.map((item, index) => ({ id: String(index), label: item }))}
    />
  )),
  StatusText: presentedView<{
    tone: "running" | "needs-you" | "failed" | "done" | "idle";
    text: string;
  }>(({ tone, text }) => <StatusText tone={tone}>{text}</StatusText>),
  Progress: presentedView<{
    value?: number;
    max?: number;
    label?: string;
    tone?: "neutral" | "accent" | "info" | "success" | "warning" | "danger";
  }>((props) => <Progress {...props} showValue={props.value !== undefined} />),
  Meter: presentedView<{
    value: number;
    min?: number;
    max?: number;
    label: string;
    valueText?: string;
  }>((props) => <Meter {...props} />),
  EmptyState: presentedView<{ title: string; description?: string }>((props) => (
    <EmptyState {...props} showDescription />
  )),

  DescriptionList: presentedView<{ items: { label: string; value: string }[] }>(({ items }) => (
    <DescriptionList>
      {items.map(({ label, value }, index) => (
        <DescriptionItem key={index} term={label}>
          {value}
        </DescriptionItem>
      ))}
    </DescriptionList>
  )),
  StatRow: presentedView<{ label: string; items: { label: string; value: string }[] }>(
    ({ label, items }) => (
      <StatRow label={label}>
        {items.map((item, index) => (
          <StatTile key={index} label={item.label} value={item.value} />
        ))}
      </StatRow>
    ),
  ),
  Table: presentedView<{ caption: string; columns: string[]; rows: string[][] }>(
    ({ caption, columns, rows }) => (
      <SortableDataTable
        rows={rows.map((cells, index) => ({
          id: String(index),
          ...Object.fromEntries(cells.map((cell, cellIndex) => [`c${cellIndex}`, cell])),
        }))}
        rowKey="id"
        caption={caption}
        columns={columns.map((label, index) => ({ key: `c${index}`, label }))}
      />
    ),
  ),
  BarChart: presentedView<{
    label: string;
    unit?: string;
    items: { label: string; value: number }[];
  }>(function BarChartView({ label, unit, items }) {
    const t = useT();
    return (
      <BarChart
        data={chartData(items).map((item) => ({ ...item, axisLabel: item.label }))}
        label={label}
        period=""
        unit={unit}
        categoryLabel={t("Name")}
        showAverage={false}
        formatValue={(value) => formatNumber(value)}
        height={168}
      />
    );
  }),
  LineChart: presentedView<{
    label: string;
    unit?: string;
    series: { key: string; label: string }[];
    points: { label: string; values: Record<string, number> }[];
  }>(({ label, unit, series, points }) => (
    <LineChart
      label={label}
      unit={unit}
      series={series}
      data={points.map((point, index) => ({
        key: String(index),
        label: point.label,
        axisLabel: point.label,
        values: point.values,
      }))}
      formatValue={(value) => formatNumber(value)}
      height={168}
    />
  )),
  DonutChart: presentedView<{
    label: string;
    unit?: string;
    items: { label: string; value: number }[];
  }>(({ label, unit, items }) => (
    <DonutChart
      data={chartData(items)}
      label={label}
      unit={unit}
      formatValue={(value) => formatNumber(value)}
    />
  )),
};
