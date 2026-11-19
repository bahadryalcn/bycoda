import { errorText } from "../../shared/lib/errors";
import { Text } from "../../shared/ui/Text";
import { LiveText } from "../../shared/ui/LiveText";
import { EmptyState } from "../../shared/ui/EmptyState";
import { Alert } from "../../shared/ui/Alert";
import { useConnectionErrorShownCentrally } from "../../shared/ui/connectionErrorGate";
import { Button } from "../../shared/ui/Button";
import { InfoPopover } from "../../shared/ui/InfoPopover";
import { Meter } from "../../shared/ui/Meter";
import { Surface } from "../../shared/ui/Surface";
import { SectionLabel } from "../../shared/ui/SectionLabel";
import { RefreshCw } from "../../shared/ui/icons";
import { t, useLocale, getLocale, dateTimeFormat } from "../../shared/i18n/technical";
import { formatBytes } from "../../shared/i18n/format";
import { numberFormat } from "../../shared/i18n/numberFormat";
import { RESOURCE_SAMPLE_LIMIT } from "../../shared/diagnostics/resourceSampleLimit";
import { useEffect, useRef, useState } from "react";
import { hostFeatureRequest, hostToolRequest } from "../connections/model/hostFeatureClient";
import { hostToolTargetKey, type HostToolTarget } from "../connections/model/hostToolTarget";
import {
  peekToolsDraftPart,
  subscribeToolsDraftTransfer,
  writeToolsDraftPart,
} from "./toolsDraftTransfer";
import { DescriptionItem, DescriptionList } from "../../shared/ui/DescriptionList";
import { Disclosure } from "../../shared/ui/Disclosure";
import { DataTable, DataTableRow } from "../../shared/ui/SortableDataTable";
import "./diagnostics-panel.css";

export type DiagnosticsSample = {
  at: number;
  host: {
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    logicalCpus: number;
    loadAverage: number[] | null;
  };
  process: {
    pid: number;
    rssBytes: number;
    heapUsedBytes: number;
    cpuPercent: number | null;
    uptimeSeconds: number;
  };
};
type Sample = DiagnosticsSample;
type Props = {
  cwd: string;
  hostTarget?: HostToolTarget;
  hostLabel?: string;
  active?: boolean;
  transferScope?: import("./toolsDraftTransfer").ToolsDraftScope;
};
const mib = (bytes: number) => formatBytes(bytes, { locale: getLocale() });
const percent = (value: number) =>
  numberFormat(getLocale(), { style: "percent", maximumFractionDigits: 1 }).format(value / 100);
const time = (at: number) =>
  dateTimeFormat(getLocale(), { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(at);

function ResourceChart({
  samples,
  metric,
  label,
}: {
  samples: Sample[];
  metric: "cpu" | "memory";
  label: string;
}) {
  const [tableOpen, setTableOpen] = useState(false);
  const values = samples.map((sample) =>
    metric === "cpu" ? sample.process.cpuPercent : sample.process.rssBytes / 1024 ** 2,
  );
  // Same text the data table shows: one unit per metric, a gap for missing CPU readings.
  const formatValue = (value: number | null) =>
    value === null
      ? t("CPU reading unavailable")
      : metric === "cpu"
        ? `${value.toFixed(1)}%`
        : `${value.toFixed(1)} MiB`;
  const readings = values.filter((value): value is number => value !== null);
  // The chart's accessible name is a short summary; every sample is in the table below.
  const summary = readings.length
    ? `${t("Latest")} ${formatValue(values[values.length - 1])}, ${t("Minimum")} ${formatValue(Math.min(...readings))}, ${t("Maximum")} ${formatValue(Math.max(...readings))}`
    : samples.length
      ? t("CPU reading unavailable")
      : t("No samples yet");
  const ceiling =
    metric === "cpu"
      ? Math.max(100, ...values.map((value) => value ?? 0))
      : Math.max(1, ...values.map((value) => value ?? 0)) * 1.2;
  const start = samples[0]?.at ?? 0;
  const span = (samples[samples.length - 1]?.at ?? start) - start;
  const points = values.map((value, index) =>
    value === null
      ? null
      : {
          x: span > 0 ? 8 + ((samples[index].at - start) / span) * 304 : 312,
          y: 100 - (value / ceiling) * 88,
          value,
        },
  );
  // Missing CPU readings are gaps, never zeroes or invented history.
  const path = points
    .map((point, index) =>
      point
        ? `${index === 0 || !points[index - 1] ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`
        : "",
    )
    .join(" ");
  return (
    <Text
      as="div"
      size="caption"
      tone="inherit"
      leading="inherit"
      className={`resource-chart resource-chart-${metric}`}
    >
      <div className="resource-chart-scale" aria-hidden="true">
        <span>{metric === "cpu" ? `${ceiling.toFixed(0)}%` : `${ceiling.toFixed(0)} MiB`}</span>
        <span>0</span>
      </div>
      <svg viewBox="0 0 320 112" role="img" aria-label={`${label}: ${summary}`}>
        {[12, 56, 100].map((y) => (
          <line key={y} x1="8" x2="312" y1={y} y2={y} className="resource-chart-grid" />
        ))}
        <path d={path} className="resource-chart-line" />
        {points.map((point, index) =>
          point ? (
            <circle key={index} cx={point.x} cy={point.y} r="3" className="resource-chart-point" />
          ) : null,
        )}
      </svg>
      <div className="resource-chart-times" aria-hidden="true">
        <span>{samples.length > 1 ? time(start) : "—"}</span>
        <span>{samples.length ? time(samples[samples.length - 1].at) : "—"}</span>
      </div>
      <Disclosure
        size="sm"
        summary={t("Show as table")}
        open={tableOpen}
        onOpenChange={setTableOpen}
      >
        {tableOpen ? (
          <DataTable
            caption={label}
            headers={[{ label: t("Time") }, { label: t("Value") }]}
          >
            {samples.map((sample, index) => (
              <DataTableRow
                key={index}
                cells={[time(sample.at), formatValue(values[index])]}
              />
            ))}
          </DataTable>
        ) : null}
      </Disclosure>
    </Text>
  );
}
export function DiagnosticsPanel(props: Props) {
  return (
    <ProjectDiagnosticsPanel
      key={JSON.stringify([props.cwd, hostToolTargetKey(props.hostTarget ?? { kind: "project" })])}
      {...props}
    />
  );
}
function ProjectDiagnosticsPanel({
  cwd,
  hostTarget = { kind: "project" },
  hostLabel,
  active = true,
  transferScope,
}: Props) {
  useLocale();
  const [samples, setSamples] = useState<Sample[]>(() =>
    transferScope ? (peekToolsDraftPart(transferScope, "diagnostics")?.samples ?? []) : [],
  );
  useEffect(() => {
    if (!transferScope) return;
    return subscribeToolsDraftTransfer(transferScope, ({ diagnostics }) => {
      if (diagnostics) setSamples(diagnostics.samples);
    });
  }, [transferScope?.cwd, transferScope?.sessionId, transferScope?.targetValue]);
  useEffect(() => {
    if (active && transferScope) writeToolsDraftPart(transferScope, "diagnostics", { samples });
  }, [active, transferScope?.cwd, transferScope?.sessionId, transferScope?.targetValue, samples]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shownCentrally = useConnectionErrorShownCentrally(error);
  const alive = useRef(false);
  const visible = useRef(active);
  visible.current = active;
  const pending = useRef(false);
  const delay = useRef<{ timer: ReturnType<typeof setTimeout>; resolve: () => void } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (delay.current) {
        clearTimeout(delay.current.timer);
        delay.current.resolve();
        delay.current = null;
      }
    };
  }, []);
  const sample = samples[samples.length - 1];
  const memoryUsed =
    sample && sample.host.totalMemoryBytes > 0
      ? Math.min(
          100,
          Math.max(0, (1 - sample.host.freeMemoryBytes / sample.host.totalMemoryBytes) * 100),
        )
      : null;
  const read = async () => {
    if (pending.current || !visible.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const request = () =>
        hostTarget.kind === "project"
          ? hostFeatureRequest<{ samples: Sample[] }>(
              cwd,
              "resources.diagnostics",
              "resources.read",
            )
          : hostToolRequest<{ samples: Sample[] }>(
              cwd,
              "resources.diagnostics",
              "resources.read",
              {},
              hostTarget,
            );
      const result = await request();
      if (!alive.current || !visible.current) return;
      setSamples(result.samples);
      // One user request includes the two samples needed for a useful CPU measurement.
      if (result.samples[result.samples.length - 1]?.process.cpuPercent === null) {
        await new Promise<void>((resolve) => {
          delay.current = { timer: setTimeout(resolve, 1100), resolve };
        });
        delay.current = null;
        if (!alive.current || !visible.current) return;
        const measured = await request();
        if (alive.current) setSamples(measured.samples);
      }
    } catch (cause) {
      if (alive.current) setError(errorText(cause));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section
      className="host-tool-panel host-resources"
      aria-label={t("Host resource diagnostics")}
      aria-busy={busy}
    >
      <header className="resource-header">
        <Button
          motion="none"
          variant="ghost"
          iconOnly
          label={error && !shownCentrally ? t("Retry") : t("Sample now")}
          loading={busy}
          loadingLabel={t("Measuring…")}
          disabled={busy}
          onClick={() => void read()}
        >
          <RefreshCw className="icon-sm" aria-hidden />
        </Button>
        <Text
          size="caption"
          tone="secondary"
          leading="inherit"
          className="resource-sample-status"
        >
          {busy ? t("Measuring…") : sample ? time(sample.at) : t("No samples yet")}
        </Text>
        {/* Sample timestamps change on every measurement; only the start of a measurement is announced. */}
        <LiveText className="sr-only" text={busy ? t("Measuring…") : ""} />
        <Text size="caption" tone="secondary" leading="inherit" className="resource-scope">
          {hostLabel ?? t("Host process")}
        </Text>
        <InfoPopover label={t("Measurement details")}>
          {sample ? (
            <DescriptionList size="sm">
              <DescriptionItem term={t("Node heap")}>
                {mib(sample.process.heapUsedBytes)}
              </DescriptionItem>
              <DescriptionItem term={t("Logical CPUs")}>{sample.host.logicalCpus}</DescriptionItem>
            </DescriptionList>
          ) : null}
          <p>
            {t(
              "Samples only when requested. CPU and memory describe the host's Node process; provider child processes are excluded. Up to {p0} samples are retained.",
              { p0: RESOURCE_SAMPLE_LIMIT },
            )}
          </p>
        </InfoPopover>
      </header>
      {error && !shownCentrally ? <Alert tone="danger">{error}</Alert> : null}
      {!sample && !busy && !error ? (
        <EmptyState
          description={t("Take a sample to start the charts.")}
          action={{
            label: t("Take a sample"),
            disabled: busy,
            onClick: () => void read(),
          }}
        />
      ) : null}
      {sample ? (
        <>
          <div className="resource-cards">
            <Surface as="article" variant="page" className="resource-card">
              <SectionLabel as="h3">{t("bycoda host CPU")}</SectionLabel>
              <strong className="resource-value">
                {sample?.process.cpuPercent != null
                  ? percent(sample.process.cpuPercent)
                  : "—"}
              </strong>
              <ResourceChart samples={samples} metric="cpu" label={t("bycoda host CPU")} />
            </Surface>
            <Surface as="article" variant="page" className="resource-card">
              <SectionLabel as="h3">{t("bycoda host memory")}</SectionLabel>
              <strong className="resource-value">
                {sample ? mib(sample.process.rssBytes) : "—"}
              </strong>
              <ResourceChart samples={samples} metric="memory" label={t("bycoda host memory")} />
            </Surface>
          </div>
          <Surface as="article" variant="page" className="resource-card resource-system-memory">
            <Text
              size="caption"
              tone="inherit"
              leading="inherit"
              as="div"
              className="resource-memory-heading"
            >
              <SectionLabel as="h3">{t("Computer memory")}</SectionLabel>
              <strong>
                {memoryUsed !== null ? `${percent(memoryUsed)} ${t("Used")}` : "—"}
              </strong>
            </Text>
            <Meter label={t("Computer memory")} value={memoryUsed} warning={75} danger={90} />
            <Text
              size="micro"
              tone="inherit"
              leading="inherit"
              as="div"
              className="resource-memory-legend"
            >
              <span>
                {t("Available")}{" "}
                <Text size="inherit" tone="primary" weight="medium" leading="inherit" as="strong">
                  {sample ? mib(sample.host.freeMemoryBytes) : "—"}
                </Text>
              </span>
              <span>
                {t("Total")}{" "}
                <Text size="inherit" tone="primary" weight="medium" leading="inherit" as="strong">
                  {sample ? mib(sample.host.totalMemoryBytes) : "—"}
                </Text>
              </span>
            </Text>
          </Surface>
        </>
      ) : null}
      {sample ? (
        <Text
          size="micro"
          tone="inherit"
          leading="inherit"
          as="div"
          className="resource-history-caption"
        >
          <span>{t("Sample history")}</span>
          <span>{samples.length} / {RESOURCE_SAMPLE_LIMIT}</span>
        </Text>
      ) : null}
    </section>
  );
}
