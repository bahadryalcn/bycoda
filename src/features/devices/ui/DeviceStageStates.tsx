import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import type { ReactNode } from "react";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Smartphone } from "../../../shared/ui/icons";
import type { DeviceSummary } from "../types";

/** Device host is not running: one explanation and the start action, centered in the pane. */
export function DeviceConnectState({
  installed,
  connecting,
  connectDisabled,
  setupOpen,
  onConnect,
  onSetup,
}: {
  installed: boolean;
  connecting: boolean;
  connectDisabled: boolean;
  setupOpen: boolean;
  onConnect: () => void;
  onSetup: (anchor: HTMLElement) => void;
}) {
  return (
    <Text
      as="div"
      size="caption"
      tone="inherit"
      leading="inherit"
      className="device-panel-state device-panel-connect"
    >
      <Smartphone className="device-panel-state-icon" tone="secondary" aria-hidden />
      <Text
        as="p"
        size="body"
        tone="primary"
        weight="medium"
        leading="inherit"
        className="device-panel-state-title"
      >
        {t("Connect a device")}
      </Text>
      <Text as="p" size="caption" tone="secondary" leading="relaxed" className="host-tool-muted">
        {t(
          "Connect an Android phone with USB debugging, or use an emulator. iOS simulators require a Mac with Xcode.",
        )}
      </Text>
      <div className="device-panel-state-actions">
        <Button
          variant="primary"
          loading={connecting}
          disabled={connectDisabled}
          onClick={onConnect}
        >
          {installed ? t("Connect devices") : t("Set up and connect")}
        </Button>
        <Button
          variant="ghost"
          aria-haspopup="dialog"
          aria-expanded={setupOpen}
          onClick={(event) => onSetup(event.currentTarget)}
        >
          {t("Setup and access")}
        </Button>
      </div>
    </Text>
  );
}

/** One device as a row: icon tile, name, facts line and its action. */
function DeviceRow({
  item,
  facts,
  action,
}: {
  item: DeviceSummary;
  facts: string;
  action: ReactNode;
}) {
  return (
    <div className="device-panel-device-row" data-booted={item.booted}>
      <Text
        size="inherit"
        tone="secondary"
        {...surfaceAttributes(
          { frame: "pane", edge: "all", radius: "control" },
          "device-panel-device-tile",
        )}
        aria-hidden
      >
        <Smartphone className="icon-sm" />
      </Text>
      <span className="device-panel-device-text">
        <Text
          truncate
          size="body"
          tone="primary"
          weight="medium"
          leading="inherit"
          className="device-panel-device-name"
        >
          {item.name}
        </Text>
        <Text
          truncate
          size="caption"
          tone="secondary"
          leading="inherit"
          className="device-panel-device-facts"
        >
          {facts}
        </Text>
      </span>
      {action}
    </div>
  );
}

/**
 * Stage content while no screen is shown: loading, a stopped or unavailable device with
 * its start action, a booted device waiting for its first frame, or the device list.
 */
export function DeviceWaitingState({
  devices,
  device,
  selected,
  loadingDevices,
  error,
  live,
  facts,
  booting,
  bootDisabled,
  refreshing,
  refreshDisabled,
  onBoot,
  onRefresh,
  onSetup,
  onSelect,
}: {
  devices: DeviceSummary[];
  device?: DeviceSummary;
  selected: string;
  loadingDevices: boolean;
  error: boolean;
  live: boolean;
  facts: (item: DeviceSummary) => string;
  booting: boolean;
  bootDisabled: boolean;
  refreshing: boolean;
  refreshDisabled: boolean;
  onBoot: () => void;
  onRefresh: () => void;
  onSetup: (anchor: HTMLElement) => void;
  onSelect: (id: string, booted: boolean) => void;
}) {
  if (loadingDevices)
    return (
      <Text
        as="div"
        size="caption"
        tone="secondary"
        leading="inherit"
        className="device-panel-waiting"
        role="status"
      >
        <LoadingText>{t("Loading devices…")}</LoadingText>
      </Text>
    );
  if (device && !device.booted)
    return (
      <Text
        as="div"
        size="caption"
        tone="secondary"
        leading="inherit"
        className="device-panel-waiting"
        role="status"
      >
        <DeviceRow
          item={device}
          facts={facts(device)}
          action={
            device.physical ? (
              <Button loading={refreshing} disabled={refreshDisabled} onClick={onRefresh}>
                {t("Refresh devices")}
              </Button>
            ) : (
              <Button variant="primary" loading={booting} disabled={bootDisabled} onClick={onBoot}>
                {device.platform === "ios" ? t("Start simulator") : t("Start emulator")}
              </Button>
            )
          }
        />
        <p className="device-panel-waiting-text">
          {device.physical
            ? t(
                "This phone is not available. Connect it with USB debugging enabled and unlocked, then refresh devices.",
              )
            : device.platform === "ios"
              ? t("Start this simulator to view or control it.")
              : t("Start this emulator to view or control it.")}
        </p>
        {device.physical ? (
          <div className="device-panel-waiting-actions">
            <Button
              variant="ghost"
              aria-haspopup="dialog"
              onClick={(event) => onSetup(event.currentTarget)}
            >
              {t("Setup and access")}
            </Button>
          </div>
        ) : null}
      </Text>
    );
  if (device?.booted && !error)
    return (
      <Text
        as="div"
        size="caption"
        tone="secondary"
        leading="inherit"
        className="device-panel-waiting"
        role="status"
      >
        <Smartphone className="device-panel-state-icon" tone="secondary" aria-hidden />
        <p className="device-panel-waiting-text">
          {live ? t("Loading device screen…") : t("Resume live view to follow the device screen.")}
        </p>
      </Text>
    );
  if (!devices.length || selected)
    return (
      <Text
        as="div"
        size="caption"
        tone="secondary"
        leading="inherit"
        className="device-panel-waiting"
        role="status"
      />
    );
  return (
    <Text
      as="div"
      size="caption"
      tone="secondary"
      leading="inherit"
      className="device-panel-waiting"
      role="status"
    >
      <p className="device-panel-waiting-text">{t("Select a device to view its screen.")}</p>
      <div
        {...surfaceAttributes(
          { frame: "card", edge: "all", radius: "card" },
          "device-panel-device-list",
        )}
      >
        {devices.map((item) => (
          <DeviceRow
            key={item.id}
            item={item}
            facts={facts(item)}
            action={
              <Button
                aria-label={
                  item.booted
                    ? t("Open {p0}", { p0: item.name })
                    : t("Select {p0}", { p0: item.name })
                }
                onClick={() => onSelect(item.id, item.booted)}
              >
                {item.booted ? t("Open") : t("Select")}
              </Button>
            }
          />
        ))}
      </div>
    </Text>
  );
}
