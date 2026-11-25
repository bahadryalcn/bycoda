import { surfaceAttributes } from "../../../shared/ui/Surface";
import { formatNumber } from "../../../shared/i18n";
import { t, useLocale } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import type { DeviceAction } from "../types";
import { useState } from "react";
import {
  Accessibility,
  Crosshair,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Minus,
  Plus,
  Settings,
  Smartphone,
  Terminal,
} from "../../../shared/ui/icons";

type Action = {
  loading?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
};

/** The device rail's overflow: icon-led inspection, conversation and setup actions, then zoom. */
export function DeviceOptionsMenu({
  inspect,
  coordinates,
  addDevice,
  output,
  zoom,
  onZoom,
  onSetup,
  fold,
}: {
  inspect: Action;
  coordinates: Action;
  addDevice?: Action;
  output?: () => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  onSetup: () => void;
  fold?: {
    loading: boolean;
    disabled: boolean;
    disabledReason?: string;
    onFold: (posture: Extract<DeviceAction, { type: "fold" }>["posture"]) => void;
  };
}) {
  useLocale();
  const [foldPosture, setFoldPosture] =
    useState<Extract<DeviceAction, { type: "fold" }>["posture"]>();
  const foldDevice = (posture: Extract<DeviceAction, { type: "fold" }>["posture"]) => {
    setFoldPosture(posture);
    fold?.onFold(posture);
  };
  return (
    <>
      <div className="device-panel-menu-actions">
        {fold && (
          <>
            <Button
              variant="item"
              loading={fold.loading && foldPosture === "closed"}
              disabled={fold.disabled || fold.loading}
              disabledReason={fold.disabledReason}
              onClick={() => foldDevice("closed")}
            >
              <Minimize2 className="icon-sm" aria-hidden />
              {t("Fold device")}
            </Button>
            <Button
              variant="item"
              loading={fold.loading && foldPosture === "half-open"}
              disabled={fold.disabled || fold.loading}
              disabledReason={fold.disabledReason}
              onClick={() => foldDevice("half-open")}
            >
              <Smartphone className="icon-sm" aria-hidden />
              {t("Half-open device")}
            </Button>
            <Button
              variant="item"
              loading={fold.loading && foldPosture === "open"}
              disabled={fold.disabled || fold.loading}
              disabledReason={fold.disabledReason}
              onClick={() => foldDevice("open")}
            >
              <Maximize2 className="icon-sm" aria-hidden />
              {t("Unfold device")}
            </Button>
          </>
        )}
        <Button
          variant="item"
          disabled={inspect.disabled}
          disabledReason={inspect.disabledReason}
          loading={inspect.loading}
          onClick={inspect.onClick}
        >
          <Accessibility className="icon-sm" aria-hidden />
          {t("Accessibility snapshot")}
        </Button>
        <Button
          variant="item"
          disabled={coordinates.disabled}
          disabledReason={coordinates.disabledReason}
          onClick={coordinates.onClick}
        >
          <Crosshair className="icon-sm" aria-hidden />
          {t("Coordinate controls")}
        </Button>
        {addDevice && (
          <Button
            variant="item"
            loading={addDevice.loading}
            disabled={addDevice.disabled}
            disabledReason={addDevice.disabledReason}
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
        <Button
          variant="ghost"
          iconOnly
          label={t("Zoom out")}
          disabled={zoom <= 1}
          disabledReason={t("Minimum zoom reached")}
          onClick={() => onZoom(Math.max(1, zoom - 0.25))}
        >
          <Minus className="icon-sm" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          className="device-panel-zoom-value"
          tooltip={t("Fit to panel")}
          disabled={zoom === 1}
          disabledReason={t("Already fitted to panel")}
          onClick={() => onZoom(1)}
        >
          {formatNumber(zoom, { style: "percent" })}
        </Button>
        <Button
          variant="ghost"
          iconOnly
          label={t("Zoom in")}
          disabled={zoom >= 3}
          disabledReason={t("Maximum zoom reached")}
          onClick={() => onZoom(Math.min(3, zoom + 0.25))}
        >
          <Plus className="icon-sm" aria-hidden />
        </Button>
      </div>
    </>
  );
}
