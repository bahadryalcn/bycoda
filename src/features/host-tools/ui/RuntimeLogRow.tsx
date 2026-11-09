import { Timestamp } from "../../../shared/ui/Timestamp";
import { memo, useRef, useState } from "react";
import { t, getLocale } from "../../../shared/i18n/technical";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
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
      className="runtime-log-row"
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
            <div className="runtime-log-meta">
              <span className="runtime-log-kind" data-source={entry.source}>
                {entry.source === "browser" ? "[BROWSER]" : "[SERVER]"}
              </span>
              <Timestamp value={entry.timestamp} format="time-seconds" />
              <span className="runtime-log-level">
                {LEVEL_LABELS[runtimeLogDisplayLevel(entry)]}
              </span>
              <OverflowTooltip label={sourceLabel}>
                <span className="runtime-log-source-label">{sourceLabel}</span>
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
                    ×{group.entries.length}
                  </Badge>
                </Tooltip>
              ) : null}
              <span className="runtime-log-details-trigger">{t("Details")}</span>
            </div>
            <p className="runtime-log-message">{entry.message || t("Empty log message")}</p>
          </div>
        }
      >
        {expanded ? (
          <div className="runtime-log-detail-body">
            <pre className="runtime-log-full-message">{entry.message}</pre>
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
                  <code>
                    {entry.location.file}
                    {entry.location.line ? ":" + entry.location.line : ""}
                    {entry.location.column ? ":" + entry.location.column : ""}
                  </code>
                )}
              </div>
            ) : null}
            {entry.details !== undefined ? (
              <div className="runtime-log-object">
                <h4>{t("Objects")}</h4>
                <ObjectInspector value={entry.details} />
              </div>
            ) : null}
            {entry.stack ? (
              <div>
                <h4>{t("Stack trace")}</h4>
                <pre>{entry.stack}</pre>
              </div>
            ) : null}
            {group.entries.length > 1 ? (
              <p className="runtime-logs-hint">
                {t("First seen {p0}; last seen {p1}.", {
                  p0: new Date(group.firstTimestamp).toLocaleTimeString(getLocale()),
                  p1: time,
                })}
              </p>
            ) : null}
          </div>
        ) : null}
      </Disclosure>
    </li>
  );
});
