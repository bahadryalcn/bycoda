import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { useT } from "../../../shared/i18n";
import { ArrowLeft, ChevronRight, SlidersHorizontal } from "../../../shared/ui/icons";
import { useState } from "react";
import { useModelSource } from "./modelSource";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { LAYER } from "../../../shared/lib/layers";
import { Popover } from "../../../shared/ui/Popover";
import { ModelExtrasPanel, useModelExtrasSummary } from "./ModelExtras";
import { ModelBrowser, type ModelBrowserProps } from "./ModelBrowser";

import "./ModelPicker.css";

const MODEL_MENU_WIDTH = 310;
const SUBMENU_OVERLAP = -4;
const PROVIDER_TAB_SIZE = 32;
const PROVIDER_TAB_GAP = 4;
const PROVIDER_RAIL_PADDING = 12;

/** The current selection's extras, editable from the picker's Extras view. */
export type ModelFlyoutExtras = {
  harness: HarnessId;
  model: string;
  values: Record<string, string>;
  onSettingsChange: (values: Record<string, string>) => void;
  disabled?: boolean;
};

export function ModelFlyout({
  anchor,
  side = "right",
  onDismiss,
  extras,
  ...browser
}: Omit<ModelBrowserProps, "header" | "leading" | "body" | "footer"> & {
  anchor: HTMLButtonElement | { current: HTMLButtonElement | null };
  side?: "right" | "top";
  onDismiss?: (reason: "outside" | "escape") => void;
  /** Adds an Extras view for the current selection; only where changes are kept. */
  extras?: ModelFlyoutExtras;
}) {
  const t = useT();
  const [view, setView] = useState<"models" | "extras">("models");
  // Reserve room for the visible provider rail and a compact page of model rows.
  const menuHeight = Math.max(
    (browser.harnesses.length + 1) * PROVIDER_TAB_SIZE +
      browser.harnesses.length * PROVIDER_TAB_GAP +
      PROVIDER_RAIL_PADDING,
    300,
  );

  return (
    <Popover
      anchor={anchor}
      side={side}
      gap={side === "right" ? SUBMENU_OVERLAP : undefined}
      width={MODEL_MENU_WIDTH}
      maxHeight={menuHeight + 2}
      layer={LAYER.submenu}
      role="dialog"
      aria-label={t("Models")}
      onDismiss={(reason) => {
        // Escape steps back from Extras before it closes the picker.
        if (reason === "escape" && view === "extras") {
          setView("models");
          return;
        }
        onDismiss?.(reason);
      }}
      data-model-picker
      style={{
        height: menuHeight,
      }}
      className="flex min-h-0 overflow-hidden font-sans"
    >
      {view === "extras" && extras ? (
        <ExtrasView extras={extras} onBack={() => setView("models")} />
      ) : (
        <ModelBrowser
          {...browser}
          footer={extras ? <ExtrasEntry extras={extras} onOpen={() => setView("extras")} /> : null}
        />
      )}
    </Popover>
  );
}

/** Footer row that opens the current selection's extras. */
function ExtrasEntry({ extras, onOpen }: { extras: ModelFlyoutExtras; onOpen: () => void }) {
  const t = useT();
  const { available, changed } = useModelExtrasSummary(extras.harness, extras.model, extras.values);
  if (!available) return null;
  return (
    <Button
      variant="ghost"
      type="button"
      data-model-extras-entry
      onMouseDown={(event) => event.preventDefault()}
      onClick={onOpen}
      className="shrink-0 text-left"
    >
      <SlidersHorizontal className="icon-sm shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate">{t("Extras")}</span>
      {changed > 0 ? (
        <Badge size="xs" variant="count" tone="neutral">
          {changed}
        </Badge>
      ) : null}
      <ChevronRight className="icon-sm shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />
    </Button>
  );
}

/** The whole flyout given over to the current selection's extras. */
function ExtrasView({ extras, onBack }: { extras: ModelFlyoutExtras; onBack: () => void }) {
  const t = useT();
  const source = useModelSource();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const name = source.resolve(extras.harness, extras.model).name;
  return (
    <div
      ref={lockOverscroll}
      role="group"
      aria-label={t("Provider extras")}
      data-model-settings
      className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"
    >
      <ModelExtrasPanel
        harness={extras.harness}
        model={extras.model}
        values={extras.values}
        onSettingsChange={extras.onSettingsChange}
        disabled={extras.disabled}
        title={`${HARNESS_TITLE[extras.harness]} · ${name}`}
        leading={
          <Button
            iconOnly
            label={t("Back")}
            variant="ghost"
            type="button"
            aria-label={t("Back")}
            tooltip={t("Back")}
            onClick={onBack}
            className="-ml-1 shrink-0"
          >
            <ArrowLeft className="icon-sm" strokeWidth={1.75} />
          </Button>
        }
      />
    </div>
  );
}
