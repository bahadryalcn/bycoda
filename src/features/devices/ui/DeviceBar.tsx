import { surfaceAttributes } from "../../../shared/ui/Surface";
import type { ReactNode } from "react";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import { RefreshCw } from "../../../shared/ui/icons";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { kindLabel, platformLabel, platformVersionLabel, stateLabel } from "../model/deviceLabels";
import type { DeviceSummary } from "../types";
import { DevicePlatformIcon } from "./DevicePlatformIcon";

/**
 * The panel's one header row: the device picker (platform glyph, green while the device
 * runs), then refresh and any trailing action. Device facts live in the picker rows and
 * the trigger's tooltip, not as text beside it.
 */
export function DeviceBar({
  devices,
  selected,
  hostLabel,
  disabled,
  loading,
  refreshing,
  refreshDisabled,
  onSelect,
  onRefresh,
  children,
}: {
  devices: DeviceSummary[];
  selected: string;
  hostLabel?: string;
  disabled: boolean;
  loading: boolean;
  refreshing: boolean;
  refreshDisabled: boolean;
  onSelect: (id: string, booted: boolean) => void;
  onRefresh: () => void;
  children?: ReactNode;
}) {
  const device = devices.find((item) => item.id === selected);
  return (
    <div
      {...surfaceAttributes(
        { frame: "pane", edge: "block-end", variant: "workspace-panel" },
        "device-panel-bar",
      )}
    >
      {devices.length ? (
        <div className="device-panel-choice">
          <SearchableSelect
            hideLabel
            tooltip={
              device
                ? [
                    hostLabel,
                    platformVersionLabel(device),
                    kindLabel(device),
                    stateLabel(device),
                    device.id,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : undefined
            }
            label={t("Selected device")}
            value={selected}
            disabled={disabled}
            placeholder={t("Select a device")}
            searchPlaceholder={t("Search devices by name or ID")}
            emptyLabel={t("No matching devices")}
            onChange={(id) => {
              if (id !== selected) onSelect(id, !!devices.find((item) => item.id === id)?.booted);
            }}
            options={devices.map((item) => ({
              value: item.id,
              label: item.name,
              icon: (
                <DevicePlatformIcon
                  platform={item.platform}
                  active={item.booted}
                  label={`${platformLabel(item.platform)} · ${stateLabel(item)}`}
                />
              ),
              description: `${platformVersionLabel(item)} · ${kindLabel(item)}`,
              meta: stateLabel(item),
              keywords: `${item.id} ${kindLabel(item)} ${item.version}`,
            }))}
          />
        </div>
      ) : (
        <Text
          as="p"
          size="caption"
          tone="inherit"
          leading="relaxed"
          className="host-tool-muted device-panel-bar-text"
          role="status"
        >
          {loading
            ? t("Loading devices…")
            : t(
                "No devices found. Connect an Android phone with USB debugging enabled, or create an emulator or simulator, then refresh.",
              )}
        </Text>
      )}
      <span className="device-panel-bar-actions">
        <Button
          variant="ghost"
          iconOnly
          label={t("Refresh devices")}
          loading={refreshing}
          disabled={refreshDisabled}
          onClick={onRefresh}
        >
          <RefreshCw className="icon-sm" aria-hidden />
        </Button>
        {children}
      </span>
    </div>
  );
}
