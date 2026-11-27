import type { ReactNode } from "react";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Alert } from "../../../shared/ui/Alert";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { Check, Download, Play, RefreshCw, Square } from "../../../shared/ui/icons";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { DEVICE_HUB_VERSION } from "../../../shared/model/host-contracts/native-devices";
import { platformLabel } from "../model/deviceLabels";
import type { DeviceHostStatus } from "../types";
import { DevicePlatformIcon } from "./DevicePlatformIcon";

type Action = { loading: boolean; disabled: boolean; onClick: () => void };

/**
 * Setup and access sheet: the device host's state at a glance, one row per platform with
 * what its SDK check found, and the setup and start/stop actions.
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
  useLocale();
  const running = status.running && !unknown;
  return (
    <div className="device-panel-setup">
      <div className="device-panel-setup-host">
        {machinePicker ?? (
          <Text size="body" tone="primary" weight="medium" truncate>
            {hostLabel}
          </Text>
        )}
      </div>
      <Text as="p" size="caption" tone="muted">
        {t(
          "Viewing never enables control. Live view follows the screen while this panel is visible; closing it pauses viewing. Setup downloads pinned expo-device-hub {p0} and optional control tools into the host cache, and Stop ends the owned tool processes.",
          { p0: DEVICE_HUB_VERSION },
        )}
      </Text>
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
                ? t("{p0} · {p1}", { p0: t("Devices"), p1: t("Unknown") })
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
          disabledReason={t(
            "Wait for the current device action to finish, or set up the device first.",
          )}
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
            label: t("Retry"),
            pending: refresh.loading,
            disabled: refresh.disabled,
            onClick: refresh.onClick,
          }}
          extra={<ErrorDetails detail={status.lastError} />}
        />
      ) : null}
      <div className="host-tool-actions device-panel-setup-actions">
        <Button
          disabled={setup.disabled}
          disabledReason={t(
            "Wait for the current device action to finish, or set up the device first.",
          )}
          loading={setup.loading}
          loadingLabel={status.installed ? t("Updating…") : t("Setting up…")}
          startIcon={<Download className="icon-sm" aria-hidden />}
          onClick={setup.onClick}
        >
          {status.installed ? t("Update setup") : t("Set up device tools")}
        </Button>
        {status.running ? (
          <Button
            variant="ghost"
            disabled={stop.disabled}
            disabledReason={t(
              "Wait for the current device action to finish, or set up the device first.",
            )}
            loading={stop.loading}
            loadingLabel={t("Stopping…")}
            startIcon={<Square className="icon-sm" aria-hidden />}
            onClick={stop.onClick}
          >
            {t("Stop device host")}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={start.disabled}
            disabledReason={t(
              "Wait for the current device action to finish, or set up the device first.",
            )}
            loading={start.loading}
            loadingLabel={t("Starting…")}
            startIcon={<Play className="icon-sm" aria-hidden />}
            onClick={start.onClick}
          >
            {t("Start device host")}
          </Button>
        )}
      </div>
    </div>
  );
}
