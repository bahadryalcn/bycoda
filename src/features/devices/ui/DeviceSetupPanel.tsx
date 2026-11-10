import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Check, Download, Play, RefreshCw, Square, TriangleAlert } from "../../../shared/ui/icons";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { platformLabel } from "../model/deviceLabels";
import type { DeviceHostStatus } from "../types";
import { DevicePlatformIcon } from "./DevicePlatformIcon";

type Action = { loading: boolean; disabled: boolean; onClick: () => void };

/**
 * Setup and access sheet: the device host's state at a glance, one row per platform with
 * what its SDK check found, and the setup and start/stop actions. Background details sit
 * behind the help button instead of a paragraph.
 */
export function DeviceSetupPanel({
  status,
  hostLabel,
  unknown,
  deviceCount,
  showLastError,
  refresh,
  setup,
  start,
  stop,
}: {
  status: DeviceHostStatus;
  hostLabel?: string;
  /** The last status or discovery read failed, so the running state is not known. */
  unknown: boolean;
  deviceCount: number;
  showLastError: boolean;
  refresh: Action;
  setup: Action;
  start: Action;
  stop: Action;
}) {
  const running = status.running && !unknown;
  return (
    <div className="device-panel-setup">
      <div className="device-panel-setup-head">
        <StatusDot tone={unknown ? "warning" : running ? "success" : "neutral"} />
        <span className="device-panel-setup-summary">
          {hostLabel ? `${hostLabel} · ` : ""}
          {unknown ? t("Unknown") : running ? t("Device host running") : t("Device host stopped")}
          <span className="host-tool-muted">{t("{p0} devices found", { p0: deviceCount })}</span>
        </span>
        <InfoPopover>
          <p>
            {t(
              "Viewing never enables control. Live view follows the screen while this panel is visible; closing it pauses viewing. Setup downloads pinned expo-device-hub 0.12.0 and optional control tools into the host cache, and Stop ends the owned tool processes.",
            )}
          </p>
        </InfoPopover>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("Status")}
          tooltip={t("Refresh status")}
          loading={refresh.loading}
          disabled={refresh.disabled}
          onClick={refresh.onClick}
        >
          <RefreshCw className="icon-sm" aria-hidden />
        </Button>
      </div>
      <ul className="device-panel-setup-platforms">
        {status.platforms.map((item) => (
          <li key={item.platform} data-available={item.available}>
            <DevicePlatformIcon platform={item.platform} active={item.available} />
            <span className="device-panel-setup-platform">{platformLabel(item.platform)}</span>
            <span className="device-panel-setup-fact">
              {item.available ? t("SDK detected") : item.reason}
            </span>
            {item.available ? (
              <Check className="icon-sm device-panel-setup-mark" aria-hidden />
            ) : (
              <TriangleAlert className="icon-sm device-panel-setup-mark" aria-hidden />
            )}
          </li>
        ))}
      </ul>
      {showLastError && status.lastError ? (
        <pre className="device-panel-output">{status.lastError}</pre>
      ) : null}
      <div className="host-tool-actions">
        <Button disabled={setup.disabled} loading={setup.loading} onClick={setup.onClick}>
          <Download className="icon-sm" aria-hidden />
          {status.installed ? t("Update setup") : t("Set up device tools")}
        </Button>
        {status.running ? (
          <Button disabled={stop.disabled} loading={stop.loading} onClick={stop.onClick}>
            <Square className="icon-sm" aria-hidden />
            {t("Stop device host")}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={start.disabled}
            loading={start.loading}
            onClick={start.onClick}
          >
            <Play className="icon-sm" aria-hidden />
            {t("Start device host")}
          </Button>
        )}
      </div>
    </div>
  );
}
