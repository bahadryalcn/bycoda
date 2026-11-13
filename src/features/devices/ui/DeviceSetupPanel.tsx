import { surfaceAttributes } from "../../../shared/ui/Surface";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Text } from "../../../shared/ui/Text";
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
      <div className="device-panel-setup-head">
        <StatusDot tone={unknown ? "warning" : running ? "success" : "neutral"} />
        <Text
          size="body"
          tone="primary"
          weight="medium"
          leading="inherit"
          className="device-panel-setup-summary"
        >
          {hostLabel ? `${hostLabel} · ` : ""}
          {unknown ? t("Unknown") : running ? t("Device host running") : t("Device host stopped")}
          <Text
            as="span"
            size="caption"
            tone="inherit"
            leading="relaxed"
            weight="regular"
            className="host-tool-muted"
          >
            {deviceCount === undefined
              ? `${t("Devices")} · ${t("Unknown")}`
              : t("{p0} devices found", { p0: deviceCount })}
          </Text>
        </Text>
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
            <Text
              size="inherit"
              tone="primary"
              weight="medium"
              className="device-panel-setup-platform"
            >
              {platformLabel(item.platform)}
            </Text>
            <Text size="inherit" tone="secondary" className="device-panel-setup-fact">
              {item.available ? t("SDK detected") : item.reason}
            </Text>
            {item.available ? (
              <Check className="icon-sm device-panel-setup-mark" tone="success" aria-hidden />
            ) : (
              <TriangleAlert
                className="icon-sm device-panel-setup-mark"
                tone="warning"
                aria-hidden
              />
            )}
          </Text>
        ))}
      </ul>
      {showLastError && status.lastError ? (
        <OutputBlock size="micro" tone="primary" leading="inherit" className="device-panel-output">
          {status.lastError}
        </OutputBlock>
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
