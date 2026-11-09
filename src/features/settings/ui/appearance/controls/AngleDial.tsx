import { type KeyboardEvent, type PointerEvent } from "react";
import { t } from "../../../../../shared/i18n";
import styles from "./GradientStrip.module.css";

export function AngleDial({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (angle: number) => void;
  disabled?: boolean;
}) {
  const updatePointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    onChange(Math.round(((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.nativeEvent.isComposing) return;
    const step = event.shiftKey ? 15 : 1;
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 360;
    else if (event.key === "ArrowUp" || event.key === "ArrowRight") next = value + step;
    else if (event.key === "ArrowDown" || event.key === "ArrowLeft") next = value - step;
    else return;
    event.preventDefault();
    onChange(Math.max(0, Math.min(360, next)));
  };
  return (
    <div className={styles.dialWrap}>
      <div
        role="slider"
        aria-label={t("Gradient angle")}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={value}
        aria-valuetext={`${value}°`}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        className={styles.dial}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          updatePointer(event);
        }}
        onPointerMove={(event) => {
          if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId))
            updatePointer(event);
        }}
      >
        <span className={styles.needle} style={{ transform: `rotate(${value}deg)` }} />
      </div>
      <span>{value}°</span>
    </div>
  );
}
