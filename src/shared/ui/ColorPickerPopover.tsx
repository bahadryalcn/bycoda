import { useT } from "../i18n";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from "../lib/colorUtils";
import { Pipette } from "./icons";
import { isImeComposition } from "../lib/keyboard";

type Props = {
  value: string;
  onChange: (hex: string) => void;
};

export function ColorSwatchRow({
  colors,
  labels,
  colorIndex,
  customColor,
  customPickerOpen,
  customHighlighted,
  onPickIndex,
  onToggleCustom,
}: {
  colors: readonly string[];
  labels?: readonly string[];
  colorIndex: number | null | undefined;
  customColor: string | null | undefined;
  customPickerOpen: boolean;
  customHighlighted?: boolean;
  onPickIndex: (index: number) => void;
  onToggleCustom?: () => void;
}) {
  const t = useT();
  const pipetteActive = customHighlighted ?? (customColor != null || customPickerOpen);
  return (
    <div className="flex flex-wrap items-center justify-between gap-1 px-0.5">
      {colors.map((color, index) => {
        const label = labels?.[index] ?? `Color ${index + 1}`;
        const selected =
          customColor == null && (colorIndex === index || (colorIndex == null && index === 0));
        return (
          <button
            key={color}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={selected}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPickIndex(index)}
            className="grid size-(--ui-color-swatch-target) shrink-0 place-items-center rounded-full"
          >
            <span
              className={`size-3.5 rounded-full ${
                selected ? "ring-2 ring-content/80 ring-offset-1 ring-offset-transparent" : ""
              }`}
              style={{ background: color }}
            />
          </button>
        );
      })}
      <button
        type="button"
        title={t("Custom color")}
        aria-label={t("Custom color")}
        aria-expanded={customPickerOpen}
        aria-pressed={customColor != null}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggleCustom}
        className="grid size-(--ui-color-swatch-target) shrink-0 place-items-center rounded-full"
      >
        <span
          className={`grid size-3.5 place-items-center overflow-hidden rounded-full ${
            pipetteActive ? "ring-2 ring-content/80 ring-offset-1 ring-offset-transparent" : ""
          }`}
          style={
            customColor
              ? { background: customColor }
              : {
                  background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
                }
          }
        >
          {!customColor ? (
            <Pipette className="size-2 text-on-solid drop-shadow-sm" strokeWidth={2.25} />
          ) : null}
        </span>
      </button>
    </div>
  );
}

export function ColorPickerPopover({ value, onChange }: Props) {
  const t = useT();
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hexDraft, setHexDraft] = useState(() => normalizeHex(value));
  const currentHsv = useRef(hsv);
  const dragCleanup = useRef<(() => void) | undefined>(undefined);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hex = normalizeHex(value);
    const previous = currentHsv.current;
    const next = hsvToHex(previous.h, previous.s, previous.v) === hex ? previous : hexToHsv(hex);
    currentHsv.current = next;
    setHsv(next);
    setHexDraft(hex);
  }, [value]);
  useEffect(() => () => dragCleanup.current?.(), []);

  const applyHsv = useCallback(
    (updater: Hsv | ((prev: Hsv) => Hsv)) => {
      const next = typeof updater === "function" ? updater(currentHsv.current) : updater;
      const hex = hsvToHex(next.h, next.s, next.v);
      currentHsv.current = next;
      setHsv(next);
      setHexDraft(hex);
      onChange(hex);
    },
    [onChange],
  );

  const onHexInput = (raw: string) => {
    setHexDraft(raw);
    const trimmed = raw.trim();
    if (!/^#?[0-9a-fA-F]{6}$/.test(trimmed)) return;
    const hex = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    const next = hexToHsv(hex);
    currentHsv.current = next;
    setHsv(next);
    onChange(normalizeHex(hex));
  };

  const onSvPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = svRef.current;
    if (!el || event.button !== 0) return;
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
    if (!el || event.button !== 0) return;
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

  return (
    <div className="mt-2 rounded-lg border border-content/10 bg-content/5 p-2">
      <div
        ref={svRef}
        role="slider"
        tabIndex={0}
        aria-label={t("Saturation and brightness")}
        aria-valuetext={`${Math.round(hsv.s)}%, ${Math.round(hsv.v)}%`}
        aria-description={t("Use Left/Right for saturation and Up/Down for brightness.")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s)}
        className="relative h-28 w-full cursor-crosshair touch-none rounded-md focus-visible:outline-2 focus-visible:outline-accent"
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
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-on-solid shadow-md"
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
        tabIndex={0}
        aria-label={t("Hue")}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        className="relative mbs-2 h-3 w-full cursor-ew-resize touch-none rounded-full focus-visible:outline-2 focus-visible:outline-accent"
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
          className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-on-solid shadow-md"
          style={{
            left: `${(hsv.h / 360) * 100}%`,
            background: hueColor,
          }}
        />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span
          className="size-7 shrink-0 rounded-md border border-content/10"
          style={{ background: preview }}
          aria-hidden
        />
        <input
          type="text"
          value={hexDraft}
          spellCheck={false}
          aria-label={t("Hex color")}
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
          className="min-w-0 flex-1 rounded-md border border-content/10 bg-content/5 px-2 py-1 font-mono text-[12px] text-content focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>
    </div>
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
