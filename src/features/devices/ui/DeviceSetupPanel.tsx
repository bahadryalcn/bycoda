import type { ReactNode } from "react";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Alert } from "../../../shared/ui/Alert";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { Text } from "../../../shared/ui/Text";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Check, Download, Play, RefreshCw, Square } from "../../../shared/ui/icons";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { DEVICE_HUB_VERSION } from "../../../shared/model/host-contracts/native-devices";
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
  machinePicker,
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
  machinePicker?: ReactNode;
  /** The last status or discovery read failed, so the running state is not known. */
  unknown: boolean;
  /** Unknown until discovery succeeds; a failed read never means zero devices. */
  deviceCount?: number;
  showLastError: boolean;
  refresh: Action;
  setup: Action;
  start: Action;
  stop: Action;
}) {
  const running = status.running && !unknown;
  return (
    <div className="device-panel-setup">
      <div className="device-panel-setup-host">
        {machinePicker ?? (
          <Text size="body" tone="primary" weight="medium" truncate>
            {hostLabel}
          </Text>
        )}
        <InfoPopover>
          <p>
            {t(
              "Viewing never enables control. Live view follows the screen while this panel is visible; closing it pauses viewing. Setup downloads pinned expo-device-hub {p0} and optional control tools into the host cache, and Stop ends the owned tool processes.",
              { p0: DEVICE_HUB_VERSION },
            )}
          </p>
        </InfoPopover>
      </div>
      <div className="device-panel-setup-head">
        <div className="device-panel-setup-summary">
          <div className="device-panel-setup-state">
            <StatusDot tone={unknown ? "warning" : running ? "success" : "neutral"} />
            <Text size="body" tone="primary" weight="medium">
              {unknown
                ? t("Device host status unknown")
                : running
                  ? t("Device host running")
                  : t("Device host stopped")}
            </Text>
          </div>
          {status.running ? (
            <Text as="div" size="caption" tone="secondary">
              {deviceCount === undefined
                ? `${t("Devices")} · ${t("Unknown")}`
                : deviceCount === 1
                  ? t("1 device found")
                  : t("{p0} devices found", { p0: deviceCount })}
            </Text>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("Refresh status")}
          loading={refresh.loading}
          disabled={refresh.disabled}
          onClick={refresh.onClick}
        >
          <RefreshCw className="icon-sm" aria-hidden />
        </Button>
      </div>
      <ul
        {...surfaceAttributes(
          { frame: "card", edge: "all", radius: "card" },
          "device-panel-setup-platforms",
        )}
      >
        {status.platforms.map((item) => (
          <Text
            {...surfaceAttributes({ separator: "pane-block" })}
            as="li"
            size="caption"
            tone="inherit"
            leading="inherit"
            key={item.platform}
            data-available={item.available}
          >
            <DevicePlatformIcon platform={item.platform} active={item.available} />
            <div className="device-panel-setup-fact">
              <Text as="div" size="inherit" tone="primary" weight="medium">
                {platformLabel(item.platform)}
              </Text>
              <Text as="div" size="inherit" tone="secondary">
                {item.available ? t("SDK detected") : (item.reason ?? t("Unavailable"))}
              </Text>
            </div>
            {item.available ? <Check className="icon-sm" tone="success" aria-hidden /> : null}
          </Text>
        ))}
      </ul>
      {showLastError && status.lastError ? (
        <Alert
          tone="danger"
          title={t("Device host reported an error")}
          action={{
            label: t("Refresh status"),
            pending: refresh.loading,
            disabled: refresh.disabled,
            onClick: refresh.onClick,
          }}
          extra={
            <ErrorDetails title={t("Device host reported an error")} detail={status.lastError} />
          }
        />
      ) : null}
      <div className="host-tool-actions device-panel-setup-actions">
        <Button disabled={setup.disabled} loading={setup.loading} onClick={setup.onClick}>
          <Download className="icon-sm" aria-hidden />
          {status.installed ? t("Update setup") : t("Set up device tools")}
        </Button>
        {status.running ? (
          <Button
            variant="ghost"
            disabled={stop.disabled}
            loading={stop.loading}
            onClick={stop.onClick}
          >
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
