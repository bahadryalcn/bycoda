import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { formatNumber } from "../../../shared/i18n";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import {
  Accessibility,
  Crosshair,
  MessageSquarePlus,
  Minus,
  Plus,
  Settings,
  Terminal,
} from "../../../shared/ui/icons";

type Action = { loading?: boolean; disabled?: boolean; onClick: () => void };

/** The device rail's overflow: icon-led inspection, conversation and setup actions, then zoom. */
export function DeviceOptionsMenu({
  inspect,
  coordinates,
  addDevice,
  output,
  zoom,
  onZoom,
  onSetup,
}: {
  inspect: Action;
  coordinates: Action;
  addDevice?: Action;
  output?: () => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  onSetup: () => void;
}) {
  return (
    <>
      <div className="device-panel-menu-actions">
        <Button
          variant="item"
          disabled={inspect.disabled}
          loading={inspect.loading}
          onClick={inspect.onClick}
        >
          <Accessibility className="icon-sm" aria-hidden />
          {t("Accessibility snapshot")}
        </Button>
        <Button variant="item" disabled={coordinates.disabled} onClick={coordinates.onClick}>
          <Crosshair className="icon-sm" aria-hidden />
          {t("Coordinate controls")}
        </Button>
        {addDevice && (
          <Button
            variant="item"
            loading={addDevice.loading}
            disabled={addDevice.disabled}
            onClick={addDevice.onClick}
          >
            <MessageSquarePlus className="icon-sm" aria-hidden />
            {t("Add device to conversation")}
          </Button>
        )}
        {output && (
          <Button variant="item" onClick={output}>
            <Terminal className="icon-sm" aria-hidden />
            {t("Device action result")}
          </Button>
        )}
        <Button variant="item" onClick={onSetup}>
          <Settings className="icon-sm" aria-hidden />
          {t("Setup and access")}
        </Button>
      </div>
      <div
        {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "device-panel-zoom")}
        role="group"
        aria-label={t("Zoom")}
      >
        <Text size="caption" tone="secondary" leading="inherit" className="device-panel-zoom-label">
          {t("Zoom")}
        </Text>
        <Button
          variant="ghost"
          iconOnly
          label={t("Zoom out")}
          disabled={zoom <= 1}
          onClick={() => onZoom(Math.max(1, zoom - 0.25))}
        >
          <Minus className="icon-sm" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          className="device-panel-zoom-value"
          tooltip={t("Fit to panel")}
          disabled={zoom === 1}
          onClick={() => onZoom(1)}
        >
          {formatNumber(zoom, { style: "percent" })}
        </Button>
        <Button
          variant="ghost"
          iconOnly
          label={t("Zoom in")}
          disabled={zoom >= 3}
          onClick={() => onZoom(Math.min(3, zoom + 0.25))}
        >
          <Plus className="icon-sm" aria-hidden />
        </Button>
      </div>
    </>
  );
}
