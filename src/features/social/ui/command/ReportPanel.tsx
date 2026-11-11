import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Heading } from "../../../../shared/ui/Heading";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import { Surface } from "../../../../shared/ui/Surface";
import type { AiReport } from "../../model/socialActions";
import type { ReportState } from "./useCommandScreen";

export type ReportPanelProps = {
  report: ReportState | undefined;
  busy: boolean;
  onLoad: (period: "day" | "week") => void;
};

function ReportList({ title, lines }: { title: string; lines: string[] }) {
  if (!lines.length) return null;
  return (
    <div className="command-report-group">
      <SectionLabel as="h4" className="command-report-title">
        {title}
      </SectionLabel>
      <ul className="command-report-lines">
        {lines.map((line, index) => (
          <li key={`${title}-${index}`}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/** Day or week report: what was done, the results that need a look, and suggestions. */
export function ReportPanel({ report, busy, onLoad }: ReportPanelProps) {
  const [period, setPeriod] = useState<"day" | "week">("day");
  const data: AiReport | undefined = report?.data;
  return (
    <Surface
      as="section"
      variant="card"
      padding="none"
      className="command-frame"
      aria-label={t("Report")}
    >
      <header className="command-frame-header">
        <Heading size="section">{t("Report")}</Heading>
        <div className="command-report-controls">
          <SegmentedControl
            label={t("Report period")}
            value={period}
            options={[
              { value: "day", label: t("Day") },
              { value: "week", label: t("Week") },
            ]}
            onValueChange={(value) => setPeriod(value === "week" ? "week" : "day")}
          />
          <Button variant="secondary" size="sm" loading={busy} onClick={() => onLoad(period)}>
            {t("Create report")}
          </Button>
        </div>
      </header>
      {data ? (
        <div className="command-frame-body command-report-body">
          <ReportList title={t("Done")} lines={data.done} />
          <ReportList title={t("Results")} lines={data.results} />
          <ReportList title={t("Suggestions")} lines={data.suggestions} />
          {!data.done.length && !data.results.length ? (
            <p className="command-muted">{t("No AI activity in this period.")}</p>
          ) : null}
        </div>
      ) : null}
    </Surface>
  );
}
