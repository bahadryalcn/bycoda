/** Different job: Log disclosure expands structured output; it is not a committed value choice. */
import { Code } from "../../../shared/ui/Code";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text, type TextTone } from "../../../shared/ui/Text";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { memo, useRef, useState } from "react";
import { t, getLocale } from "../../../shared/i18n/technical";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Tooltip, OverflowTooltip } from "../../../shared/ui/Tooltip";
import type { OpenFileFn } from "../../search/model/search";
import { runtimeLogDisplayLevel, type RuntimeLogDisplayLevel } from "../runtimeLogPresentation";
import { runtimeLogFileTarget, type RuntimeLogGroup } from "../runtimeLogsModel";
import { ObjectInspector } from "./RuntimeLogObjectInspector";

export const LEVEL_LABELS: Record<RuntimeLogDisplayLevel, string> = {
  error: "ERROR",
  warn: "WARN",
  info: "INFO",
  debug: "DEBUG",
  http: "HTTP",
  success: "SUCCESS",
};

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
  sourceLabel,
  selectedCount,
  onSelect,
  cwd,
  onOpenFile,
}: {
  group: RuntimeLogGroup;
  sourceLabel: string;
  selectedCount: number;
  onSelect: (group: RuntimeLogGroup, checked: boolean) => void;
  cwd: string;
  onOpenFile?: OpenFileFn;
}) {
  const [expanded, setExpanded] = useState(false);
  const checkbox = useRef<HTMLInputElement>(null);
  const entry = group.entry;
  const time = new Date(entry.timestamp).toLocaleTimeString(getLocale(), { hour12: false });
  const file = runtimeLogFileTarget(cwd, entry.location);
  return (
    <li
      {...surfaceAttributes(
        { variant: selectedCount > 0 ? "selected" : undefined, frame: "stroke", edge: "block-end" },
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
              <Code
                size="caption"
                tone={entry.source === "browser" ? "info" : "feature"}
                weight="medium"
                className="runtime-log-kind"
                data-source={entry.source}
              >
                {entry.source === "browser" ? "[BROWSER]" : "[SERVER]"}
              </Code>
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
                {LEVEL_LABELS[runtimeLogDisplayLevel(entry)]}
              </Text>
              <OverflowTooltip label={sourceLabel}>
                <Text
                  size="inherit"
                  tone="secondary"
                  leading="inherit"
                  truncate
                  className="runtime-log-source-label"
                >
                  {sourceLabel}
                </Text>
              </OverflowTooltip>
              {group.entries.length > 1 ? (
                <Tooltip label={t("{p0} repeated events", { p0: group.entries.length })}>
                  <Badge
                    variant="count"
                    size="xs"
                    tone="neutral"
                    className="runtime-log-count"
                    label={t("{p0} repeated events", { p0: group.entries.length })}
                  >
                    {group.entries.length}
                  </Badge>
                </Tooltip>
              ) : null}
              <Text tone="secondary" size="inherit" className="runtime-log-details-trigger">
                {t("Details")}
              </Text>
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
                  p0: new Date(group.firstTimestamp).toLocaleTimeString(getLocale()),
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
