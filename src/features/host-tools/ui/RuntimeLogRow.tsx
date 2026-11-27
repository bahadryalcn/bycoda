/** Different job: Log disclosure expands structured output; it is not a committed value choice. */
import { Code } from "../../../shared/ui/Code";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text, type TextTone } from "../../../shared/ui/Text";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { memo, useRef, useState } from "react";
import { t, formatDate } from "../../../shared/i18n";
import { Globe, Terminal } from "../../../shared/ui/icons";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Disclosure } from "../../../shared/ui/Disclosure";
import type { OpenFileFn } from "../../search/model/search";
import { runtimeLogDisplayLevel, type RuntimeLogDisplayLevel } from "../runtimeLogPresentation";
import { runtimeLogFileTarget, type RuntimeLogGroup } from "../runtimeLogsModel";
import { ObjectInspector } from "./RuntimeLogObjectInspector";

/** Level names the user reads in the row and the level filter; the raw level stays in log text. */
export function levelLabel(level: RuntimeLogDisplayLevel): string {
  switch (level) {
    case "error":
      return t("Error");
    case "warn":
      return t("Warning");
    case "info":
      return t("Info");
    case "debug":
      return t("Debug");
    case "success":
      return t("Success");
    case "http":
      return "HTTP";
  }
}

/** Seconds-resolution 24-hour clock for an event timestamp; empty when the date is invalid. */
function clockTime(timestamp: number | string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return formatDate(date, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

const LEVEL_TONES: Record<RuntimeLogDisplayLevel, TextTone> = {
  error: "danger",
  warn: "warning",
  info: "info",
  debug: "secondary",
  http: "feature",
  success: "success",
};

export const RuntimeLogRow = memo(function RuntimeLogRow({
  group,
  selectedCount,
  onSelect,
  cwd,
  onOpenFile,
}: {
  group: RuntimeLogGroup;
  selectedCount: number;
  onSelect: (group: RuntimeLogGroup, checked: boolean) => void;
  cwd: string;
  onOpenFile?: OpenFileFn;
}) {
  const [expanded, setExpanded] = useState(false);
  const checkbox = useRef<HTMLInputElement>(null);
  const entry = group.entry;
  const time = clockTime(entry.timestamp);
  const file = runtimeLogFileTarget(cwd, entry.location);
  return (
    <li
      {...surfaceAttributes(
        {
          variant: selectedCount > 0 ? "selected" : undefined,
          frame: "pane",
          edge: "block-end",
        },
        "runtime-log-row",
      )}
      data-level={runtimeLogDisplayLevel(entry)}
      data-source={entry.source}
      data-selected={selectedCount > 0}
    >
      <div className="runtime-log-select">
        <Checkbox
          ref={checkbox}
          indeterminate={selectedCount > 0 && selectedCount < group.entries.length}

          checked={selectedCount === group.entries.length}
          aria-label={t("Select log at {p0}", { p0: time })}
          onChange={(event) => onSelect(group, event.target.checked)}
        />
      </div>
      <Disclosure
        onOpenChange={setExpanded}
        summary={
          <div className="runtime-log-summary">
            <Text
              size="caption"
              tone="inherit"
              leading="inherit"
              as="div"
              className="runtime-log-meta"
            >
              <Tooltip label={entry.source === "browser" ? t("Browser") : t("Server")}>
                <span
                  className="runtime-log-kind"
                  data-source={entry.source}
                  role="img"
                  aria-label={entry.source === "browser" ? t("Browser") : t("Server")}
                >
                  {entry.source === "browser" ? (
                    <Globe className="icon-xs" aria-hidden />
                  ) : (
                    <Terminal className="icon-xs" aria-hidden />
                  )}
                </span>
              </Tooltip>
              <Code>
                <Timestamp
                  value={entry.timestamp}
                  format="time-seconds"
                  size="caption"
                  tone="secondary"
                />
              </Code>
              <Text
                as="span"
                size="inherit"
                tone={LEVEL_TONES[runtimeLogDisplayLevel(entry)]}
                className="runtime-log-level"
              >
                {levelLabel(runtimeLogDisplayLevel(entry))}
              </Text>
              {group.entries.length > 1 ? (
                <Badge
                  variant="count"
                  size="xs"
                  tone="neutral"
                  className="runtime-log-count"
                  label={t("{p0} repeated events", {
                    p0: group.entries.length,
                  })}
                >
                  {group.entries.length}
                </Badge>
              ) : null}
            </Text>
            <Text
              as="p"
              size="micro"
              tone="primary"
              leading="normal"
              truncate
              className="runtime-log-message"
            >
              <Code>{entry.message || t("Empty log message")}</Code>
            </Text>
          </div>
        }
      >
        {expanded ? (
          <Text
            size="micro"
            tone="inherit"
            leading="inherit"
            as="div"
            className="runtime-log-detail-body"
          >
            <OutputBlock size="micro" tone="inherit" className="runtime-log-full-message">
              {entry.message}
            </OutputBlock>
            {entry.location ? (
              <div className="runtime-log-location">
                {file && onOpenFile ? (
                  <Button
                    motion="none"
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => onOpenFile(file.path, file.navigation)}
                  >
                    {file.label}
                    {file.navigation
                      ? ":" +
                        file.navigation.line +
                        (file.navigation.column ? ":" + file.navigation.column : "")
                      : ""}
                  </Button>
                ) : (
                  <Code>
                    {entry.location.file}
                    {entry.location.line ? ":" + entry.location.line : ""}
                    {entry.location.column ? ":" + entry.location.column : ""}
                  </Code>
                )}
              </div>
            ) : null}
            {entry.details !== undefined ? (
              <div className="runtime-log-object">
                <SectionLabel as="h4">{t("Objects")}</SectionLabel>
                <ObjectInspector value={entry.details} />
              </div>
            ) : null}
            {entry.stack ? (
              <div>
                <SectionLabel as="h4">{t("Stack trace")}</SectionLabel>
                <OutputBlock size="micro" tone="inherit">
                  {entry.stack}
                </OutputBlock>
              </div>
            ) : null}
            {group.entries.length > 1 ? (
              <Text
                size="micro"
                tone="inherit"
                leading="normal"
                as="p"
                className="runtime-logs-hint"
              >
                {t("First seen {p0}; last seen {p1}.", {
                  p0: clockTime(group.firstTimestamp),
                  p1: time,
                })}
              </Text>
            ) : null}
          </Text>
        ) : null}
      </Disclosure>
    </li>
  );
});
