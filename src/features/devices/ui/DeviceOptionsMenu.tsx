import type { ReactNode } from "react";
import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Minus, Plus } from "../../../shared/ui/icons";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="device-panel-menu-section">
      <h3 className="device-panel-menu-title">{title}</h3>
      {children}
    </section>
  );
}

/** The device rail's overflow: inspection, conversation and setup actions, then zoom. */
export function DeviceOptionsMenu({
  inspect,
  coordinates,
  addDevice,
  output,
  zoom,
  onZoom,
  onSetup,
  facts,
  help,
}: {
  inspect: { loading: boolean; disabled: boolean; onClick: () => void };
  coordinates: { disabled: boolean; onClick: () => void };
  addDevice?: { loading: boolean; disabled: boolean; onClick: () => void };
  output?: () => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  onSetup: () => void;
  facts?: string;
  help?: string;
}) {
  return (
    <>
      <Section title={t("Tools")}>
        <div className="device-panel-menu-actions">
          <Button
            variant="item"
            disabled={inspect.disabled}
            loading={inspect.loading}
            onClick={inspect.onClick}
          >
            {t("Accessibility snapshot")}
          </Button>
          <Button variant="item" disabled={coordinates.disabled} onClick={coordinates.onClick}>
            {t("Coordinate controls")}
          </Button>
          {addDevice && (
            <Button
              variant="item"
              loading={addDevice.loading}
              disabled={addDevice.disabled}
              onClick={addDevice.onClick}
            >
              {t("Add device to conversation")}
            </Button>
          )}
          {output && (
            <Button variant="item" onClick={output}>
              {t("Device action result")}
            </Button>
          )}
          <Button variant="item" onClick={onSetup}>
            {t("Setup and access")}
          </Button>
        </div>
      </Section>
      <Section title={t("Zoom")}>
        <div className="device-panel-zoom">
          <Button
            variant="ghost"
            iconOnly
            label={t("Zoom out")}
            disabled={zoom <= 1}
            onClick={() => onZoom(Math.max(1, zoom - 0.25))}
          >
            <Minus className="icon-sm" aria-hidden />
          </Button>
          <Button variant="ghost" onClick={() => onZoom(1)}>
            {t("Fit to panel")}
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
      </Section>
      {facts || help ? (
        <p className="device-panel-menu-facts host-tool-muted">
          <span>{facts}</span>
          {help ? (
            <InfoPopover>
              <p>{help}</p>
            </InfoPopover>
          ) : null}
        </p>
      ) : null}
    </>
  );
}
