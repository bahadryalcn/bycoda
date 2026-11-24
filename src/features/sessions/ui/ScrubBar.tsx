import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { scrubKeyValue } from "./mediaPlayback";
import styles from "./MediaPlayer.module.css";

/**
 * A pointer and keyboard scrub control over 0..max (a waveform, a seek bar, a volume bar).
 * The parent writes progress to the `--p` custom property of `ref` while playing, so the
 * fill moves without rendering; `value` only feeds the accessible value and key steps.
 */
export function ScrubBar({
  label,
  value,
  max,
  step,
  valueText,
  onChange,
  ref,
  className,
  children,
}: {
  label: string;
  value: number;
  max: number;
  step: number;
  valueText: string;
  onChange: (value: number) => void;
  ref?: Ref<HTMLDivElement>;
  className?: string;
  children?: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const seekAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    onChange(fraction * max);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = scrubKeyValue(event.key, value, max, step);
    if (next === undefined) return;
    event.preventDefault();
    onChange(next);
  };
  return (
    <div
      ref={(node) => {
        box.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max * 100) / 100}
      aria-valuenow={Math.round(value * 100) / 100}
      aria-valuetext={valueText}
      data-drag={dragging ? "" : undefined}
      className={[styles.scrub, className].filter(Boolean).join(" ")}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        seekAt(event);
      }}
      onPointerMove={(event) => {
        if (dragging) seekAt(event);
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
    >
      {children}
    </div>
  );
}
