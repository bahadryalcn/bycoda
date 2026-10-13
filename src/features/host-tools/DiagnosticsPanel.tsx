import { t, useLocale, getLocale } from "../../shared/i18n/technical";
import { useEffect, useRef, useState } from "react";
import { hostFeatureRequest, hostToolRequest } from "../connections/model/hostFeatureClient";
import { hostToolTargetKey, type HostToolTarget } from "../connections/model/hostToolTarget";
import "./diagnostics-panel.css";

type Sample = {
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
type Props = { cwd: string; hostTarget?: HostToolTarget; hostLabel?: string };
const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
const time = (at: number) => new Date(at).toLocaleTimeString(getLocale());

function ResourceChart({
  samples,
  metric,
  label,
}: {
  samples: Sample[];
  metric: "cpu" | "memory";
  label: string;
}) {
  const values = samples.map((sample) =>
    metric === "cpu" ? sample.process.cpuPercent : sample.process.rssBytes / 1024 ** 2,
  );
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
    <div className={`resource-chart resource-chart-${metric}`}>
      <div className="resource-chart-scale" aria-hidden="true">
        <span>{metric === "cpu" ? `${ceiling.toFixed(0)}%` : `${ceiling.toFixed(0)} MiB`}</span>
        <span>0</span>
      </div>
      <svg viewBox="0 0 320 112" role="img" aria-label={label}>
        <title>
          {label}:{" "}
          {samples.length
            ? samples
                .map(
                  (sample, index) =>
                    `${time(sample.at)}: ${values[index] === null ? t("CPU reading unavailable") : metric === "cpu" ? `${values[index]!.toFixed(1)}%` : mib(sample.process.rssBytes)}`,
                )
                .join("; ")
            : t("No samples yet")}
        </title>
        {[12, 56, 100].map((y) => (
          <line key={y} x1="8" x2="312" y1={y} y2={y} className="resource-chart-grid" />
        ))}
        <path d={path} className="resource-chart-line" />
        {points.map((point, index) =>
          point ? (
            <circle key={index} cx={point.x} cy={point.y} r="3" className="resource-chart-point">
              <title>
                {time(samples[index].at)} ·{" "}
                {metric === "cpu"
                  ? `${point.value.toFixed(1)}%`
                  : mib(samples[index].process.rssBytes)}
              </title>
            </circle>
          ) : null,
        )}
      </svg>
      <div className="resource-chart-times" aria-hidden="true">
        <span>{samples.length > 1 ? time(start) : "—"}</span>
        <span>{samples.length ? time(samples[samples.length - 1].at) : "—"}</span>
      </div>
    </div>
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
function ProjectDiagnosticsPanel({ cwd, hostTarget = { kind: "project" }, hostLabel }: Props) {
  useLocale();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(false);
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
    if (pending.current) return;
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
      if (!alive.current) return;
      setSamples(result.samples);
      // One user request includes the two samples needed for a useful CPU measurement.
      if (result.samples[result.samples.length - 1]?.process.cpuPercent === null) {
        await new Promise<void>((resolve) => {
          delay.current = { timer: setTimeout(resolve, 1100), resolve };
        });
        delay.current = null;
        if (!alive.current) return;
        const measured = await request();
        if (alive.current) setSamples(measured.samples);
      }
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
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
        <div className="host-tool-intro">
          <h3>{t("Resource usage")}</h3>
          <span className="host-tool-muted">{hostLabel ?? t("Host process")}</span>
        </div>
        <div className="resource-sampling">
          <button
            type="button"
            className="host-tool-primary"
            disabled={busy}
            onClick={() => void read()}
          >
            {busy ? t("Measuring…") : error ? t("Retry") : t("Sample now")}
          </button>
          <span className="host-tool-muted" role="status">
            {busy
              ? t("Measuring…")
              : sample
                ? `${t("Sampled at")} ${time(sample.at)}`
                : t("No samples yet")}
          </span>
        </div>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {!sample && !busy && !error ? (
        <p className="resource-empty">{t("Take a sample to start the charts.")}</p>
      ) : null}
      <div className="resource-cards">
        <article className="resource-card">
          <h4>{t("bycoda host CPU")}</h4>
          <strong className="resource-value">
            {sample?.process.cpuPercent != null ? `${sample.process.cpuPercent.toFixed(1)}%` : "—"}
          </strong>
          <ResourceChart samples={samples} metric="cpu" label={t("bycoda host CPU")} />
        </article>
        <article className="resource-card">
          <h4>{t("bycoda host memory")}</h4>
          <strong className="resource-value">{sample ? mib(sample.process.rssBytes) : "—"}</strong>
          <ResourceChart samples={samples} metric="memory" label={t("bycoda host memory")} />
        </article>
      </div>
      <article className="resource-card resource-system-memory">
        <div className="resource-memory-heading">
          <h4>{t("Computer memory")}</h4>
          <strong>{memoryUsed !== null ? `${memoryUsed.toFixed(1)}% ${t("Used")}` : "—"}</strong>
        </div>
        <div
          className="resource-memory-bar"
          role={memoryUsed !== null ? "meter" : undefined}
          aria-label={t("Computer memory")}
          aria-valuemin={memoryUsed !== null ? 0 : undefined}
          aria-valuemax={memoryUsed !== null ? 100 : undefined}
          aria-valuenow={memoryUsed ?? undefined}
        >
          <span style={{ inlineSize: `${memoryUsed ?? 0}%` }} />
        </div>
        <div className="resource-memory-legend">
          <span>
            {t("Available")} <strong>{sample ? gib(sample.host.freeMemoryBytes) : "—"}</strong>
          </span>
          <span>
            {t("Total")} <strong>{sample ? gib(sample.host.totalMemoryBytes) : "—"}</strong>
          </span>
        </div>
      </article>
      {sample ? (
        <div className="resource-history-caption">
          <span>{t("Sample history")}</span>
          <span>{samples.length} / 60</span>
        </div>
      ) : null}
      <details className="host-tool-help">
        <summary>{t("Measurement details")}</summary>
        {sample ? (
          <dl className="host-tool-metrics">
            <div>
              <dt>{t("Node heap")}</dt>
              <dd>{mib(sample.process.heapUsedBytes)}</dd>
            </div>
            <div>
              <dt>{t("Logical CPUs")}</dt>
              <dd>{sample.host.logicalCpus}</dd>
            </div>
          </dl>
        ) : null}
        <p className="host-tool-muted">
          {t(
            "Samples only when requested. CPU and memory describe the host's Node process; provider child processes are excluded. Up to 60 samples are retained.",
          )}
        </p>
      </details>
    </section>
  );
}
