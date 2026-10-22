import { useEffect, useRef, useState } from "react";
import { normalizeHex } from "../../../shared/lib/colorUtils";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ColorPickerPopover, ColorSwatchRow } from "../../../shared/ui/ColorPickerPopover";
import { TAB_GROUP_COLORS } from "../../workspace/model/tabGroups";
import type { ServerMetadataPatch, ServerRecord } from "../model/serverInventory";
import { serverAccentColor, serverHasColor } from "./serverColor";

/** Custom picker drags preview locally; the native store is written once the pointer settles. */
const CUSTOM_SAVE_DELAY_MS = 250;

/** Palette swatches, the custom picker and a reset. Index 0 means no color, as in project groups. */
export function ServerColorPopover({
  server,
  onPick,
}: {
  server: ServerRecord;
  onPick: (patch: ServerMetadataPatch) => void;
}) {
  useLocale();
  const { colorIndex, customColor } = server.metadata;
  const [pickerOpen, setPickerOpen] = useState(customColor != null);
  const [draft, setDraft] = useState<string>();
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; hex: string }>(undefined);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const flush = () => {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    const { hex } = pending.current;
    pending.current = undefined;
    onPickRef.current({ customColor: hex });
  };
  const cancelPending = () => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = undefined;
    setDraft(undefined);
  };
  // Closing the popover mid-drag still saves the last color.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => flush, []);
  const shownCustom = draft ?? customColor;
  const fallback = normalizeHex(TAB_GROUP_COLORS[0]);
  return (
    <div className="flex flex-col gap-3 p-3">
      <ColorSwatchRow
        colors={TAB_GROUP_COLORS}
        colorIndex={colorIndex}
        customColor={shownCustom}
        customPickerOpen={pickerOpen}
        onPickIndex={(index) => {
          cancelPending();
          setPickerOpen(false);
          onPick({ colorIndex: index === 0 ? null : index, customColor: null });
        }}
        onToggleCustom={() => setPickerOpen((open) => !open)}
      />
      {pickerOpen ? (
        <ColorPickerPopover
          value={shownCustom ?? normalizeHex(serverAccentColor(server) ?? fallback)}
          onChange={(hex) => {
            setDraft(hex);
            if (pending.current) clearTimeout(pending.current.timer);
            pending.current = { hex, timer: setTimeout(flush, CUSTOM_SAVE_DELAY_MS) };
          }}
        />
      ) : null}
      <Button
        variant="ghost"
        disabled={!serverHasColor(server) && draft == null}
        onClick={() => {
          cancelPending();
          setPickerOpen(false);
          onPick({ colorIndex: null, customColor: null });
        }}
      >
        {t("No color")}
      </Button>
    </div>
  );
}
