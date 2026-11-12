import { useT } from "../i18n";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from "../lib/colorUtils";
import { Check, Pipette } from "./icons";
import { TextField } from "./TextField";
import { Tooltip } from "./Tooltip";
import { isImeComposition } from "../lib/keyboard";
import styles from "./ColorPickerPopover.module.css";

type Props = {
  value: string;
  onChange: (hex: string) => void;
  /** The plane, hue and hex field dim and cannot be used. */
  disabled?: boolean;
  /** The colour is shown at full ink but cannot change. */
  readOnly?: boolean;
};

const HEX_DRAFT = /^#?[0-9a-fA-F]{6}$/;

/**
 * Row of preset colour swatches with an optional custom-colour button (eyedropper glyph or the saved custom colour). `colorIndex` is the selected preset; omit `onToggleCustom` to hide the custom option. It does not open the picker itself.
 * @group choice
 * @use Choosing an accent, account or server colour from a preset palette.
 * @avoid Arbitrary colour only: ColorPickerPopover. Non-colour options: SegmentedControl or Select.
 */
export function ColorSwatchRow({
  colors,
  labels,
  colorIndex,
  customColor,
  customPickerOpen,
  customHighlighted,
  onPickIndex,
  onToggleCustom,
  className,
}: {
  colors: readonly string[];
  labels?: readonly string[];
  colorIndex: number | null | undefined;
  /** The saved custom colour. Omit when the row has no custom option. */
  customColor?: string | null | undefined;
  customPickerOpen?: boolean;
  customHighlighted?: boolean;
  onPickIndex: (index: number) => void;
  /** Opens the custom picker. Without it the row shows the preset swatches only: no custom button. */
  onToggleCustom?: () => void;
  /** External placement of the row (for example a grid of swatches); colours stay internal. */
  className?: string;
}) {
  const t = useT();
  const pipetteActive = customHighlighted ?? (customColor != null || !!customPickerOpen);
  return (
    <div className={className ? `${styles.swatchRow} ${className}` : styles.swatchRow}>
      {colors.map((color, index) => {
        const label = labels?.[index] ?? `Color ${index + 1}`;
        const selected =
          customColor == null && (colorIndex === index || (colorIndex == null && index === 0));
        return (
          <Tooltip key={color} label={label} asChild>
            <button
              type="button"
              aria-label={label}
              aria-pressed={selected}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPickIndex(index)}
              className={styles.swatch}
            >
              <span className={styles.dot} style={{ background: color }}>
                {selected ? (
                  <Check className={styles.glyph} strokeWidth={3} aria-hidden="true" />
                ) : null}
              </span>
            </button>
          </Tooltip>
        );
      })}
      {onToggleCustom ? (
        <Tooltip label={t("Custom color")} asChild>
          <button
            type="button"
            aria-label={t("Custom color")}
            aria-expanded={customPickerOpen}
            aria-pressed={customColor != null}
            data-selected={pipetteActive || undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onToggleCustom}
            className={styles.swatch}
          >
            <span
              className={[styles.dot, customColor ? undefined : styles.spectrum]
                .filter(Boolean)
                .join(" ")}
              style={customColor ? { background: customColor } : undefined}
            >
              {!customColor ? (
                <Pipette className={styles.glyph} strokeWidth={2.25} aria-hidden="true" />
              ) : pipetteActive ? (
                <Check className={styles.glyph} strokeWidth={3} aria-hidden="true" />
              ) : null}
            </span>
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

/**
 * Saturation/value plane, hue slider, hex field and eyedropper for an arbitrary colour; `value` and `onChange` use hex. `disabled` dims it, `readOnly` shows the colour at full ink without changes. Hex input and contrast semantics live here, not in callers.
 * Render it inside a Popover opened from a ColorSwatchRow custom button.
 * @group fields
 * @use Picking a custom colour (appearance accent, rail background, allowed content colour).
 * @avoid Preset palette only: ColorSwatchRow. A text hex field alone: TextField.
 */
export function ColorPickerPopover({ value, onChange, disabled = false, readOnly = false }: Props) {
  const t = useT();
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hexDraft, setHexDraft] = useState(() => normalizeHex(value));
  const currentHsv = useRef(hsv);
  const dragCleanup = useRef<(() => void) | undefined>(undefined);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  // Follow an external value change during render; keep the current hue when it already maps to the value.
  const [syncedValue, setSyncedValue] = useState(value);
  if (syncedValue !== value) {
    const hex = normalizeHex(value);
    setSyncedValue(value);
    setHsv(hsvToHex(hsv.h, hsv.s, hsv.v) === hex ? hsv : hexToHsv(hex));
    setHexDraft(hex);
  }
  useLayoutEffect(() => {
    currentHsv.current = hsv;
  }, [hsv]);
  useEffect(() => () => dragCleanup.current?.(), []);

  const inert = disabled || readOnly;
  const applyHsv = (updater: Hsv | ((prev: Hsv) => Hsv)) => {
    if (inert) return;
    const next = typeof updater === "function" ? updater(currentHsv.current) : updater;
    const hex = hsvToHex(next.h, next.s, next.v);
    currentHsv.current = next;
    setHsv(next);
    setHexDraft(hex);
    onChange(hex);
  };

  const onHexInput = (raw: string) => {
    if (inert) return;
    setHexDraft(raw);
    const trimmed = raw.trim();
    if (!HEX_DRAFT.test(trimmed)) return;
    const hex = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    const next = hexToHsv(hex);
    currentHsv.current = next;
    setHsv(next);
    onChange(normalizeHex(hex));
  };

  const onSvPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = svRef.current;
    if (!el || event.button !== 0 || inert) return;
    dragCleanup.current?.();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const update = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const s = clamp01((clientX - rect.left) / rect.width) * 100;
      const v = (1 - clamp01((clientY - rect.top) / rect.height)) * 100;
      applyHsv((prev) => ({ ...prev, s, v }));
    };

    update(event.clientX, event.clientY);
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === event.pointerId) update(e.clientX, e.clientY);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    dragCleanup.current = onUp;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onHuePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = hueRef.current;
    if (!el || event.button !== 0 || inert) return;
    dragCleanup.current?.();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const update = (clientX: number) => {
      const rect = el.getBoundingClientRect();
      if (!rect.width) return;
      const h = clamp01((clientX - rect.left) / rect.width) * 360;
      applyHsv((prev) => ({ ...prev, h }));
    };

    update(event.clientX);
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === event.pointerId) update(e.clientX);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    dragCleanup.current = onUp;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const preview = hsvToHex(hsv.h, hsv.s, hsv.v);
  const hueColor = hsvToHex(hsv.h, 100, 100);
  // A half-typed or malformed draft takes the danger frame until it is completed or the field is left.
  const hexInvalid = !inert && hexDraft.trim() !== "" && !HEX_DRAFT.test(hexDraft.trim());

  return (
    <div
      className={styles.picker}
      data-disabled={disabled || undefined}
      data-readonly={readOnly || undefined}
    >
      <div
        ref={svRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-readonly={readOnly || undefined}
        aria-label={t("Saturation and brightness")}
        aria-valuetext={`${Math.round(hsv.s)}%, ${Math.round(hsv.v)}%`}
        aria-description={t("Use Left/Right for saturation and Up/Down for brightness.")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s)}
        className={styles.plane}
        style={{
          background: `linear-gradient(to top, var(--color-scrim), transparent), linear-gradient(to right, var(--color-on-solid), ${hueColor})`,
        }}
        onPointerDown={onSvPointer}
        onKeyDown={(event) => {
          if (
            isImeComposition(event.nativeEvent) ||
            !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
          )
            return;
          event.preventDefault();
          const step = event.shiftKey ? 10 : 1;
          applyHsv((previous) => ({
            ...previous,
            s: Math.max(
              0,
              Math.min(
                100,
                previous.s +
                  (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
              ),
            ),
            v: Math.max(
              0,
              Math.min(
                100,
                previous.v +
                  (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0),
              ),
            ),
          }));
        }}
      >
        <span
          className={styles.handle}
          style={{
            left: `${hsv.s}%`,
            top: `${100 - hsv.v}%`,
            background: preview,
          }}
        />
      </div>

      <div
        ref={hueRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-readonly={readOnly || undefined}
        aria-label={t("Hue")}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        className={styles.hue}
        style={{
          background:
            "linear-gradient(to right, var(--palette-hexf00), var(--palette-hexff0), var(--palette-hex0f0), var(--palette-hex0ff), var(--palette-hex00f), var(--palette-hexf0f), var(--palette-hexf00))",
        }}
        onPointerDown={onHuePointer}
        onKeyDown={(event) => {
          if (
            isImeComposition(event.nativeEvent) ||
            !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
          )
            return;
          event.preventDefault();
          const step = event.shiftKey ? 10 : 1;
          applyHsv((previous) => ({
            ...previous,
            h:
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? 360
                  : Math.max(
                      0,
                      Math.min(
                        360,
                        previous.h + (["ArrowRight", "ArrowUp"].includes(event.key) ? step : -step),
                      ),
                    ),
          }));
        }}
      >
        <span
          className={styles.handle}
          style={{
            left: `${(hsv.h / 360) * 100}%`,
            background: hueColor,
          }}
        />
      </div>

      <div className={styles.readout}>
        <span className={styles.preview} style={{ background: preview }} aria-hidden />
        <TextField
          label={t("Hex color")}
          hideLabel
          fieldClassName={styles.hexField}
          className={styles.hexInput}
          type="text"
          value={hexDraft}
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={hexInvalid || undefined}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onHexInput(e.target.value)}
          onBlur={() => setHexDraft(preview)}
          onKeyDown={(event) => {
            if (isImeComposition(event.nativeEvent)) return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setHexDraft(preview);
            }
          }}
        />
      </div>
    </div>
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
