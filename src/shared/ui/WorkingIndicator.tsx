import styles from "./WorkingIndicator.module.css";

/** Bar centers on the original 24-unit grid. */
const BARS = [4.5, 9.5, 14.5, 19.5];

/**
 * Decorative working signal. The enclosing status owns its accessible label.
 * HTML bars instead of SVG rects: transform/opacity animations on HTML
 * elements run on the compositor, while animated SVG children repaint on the
 * main thread every frame (240 times a second on high-refresh displays).
 */
export function WorkingIndicator({
  className = "inline-block w-3.5 shrink-0",
}: {
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={`${styles.indicator} ${className}`}>
      <span className={styles.grid}>
        {BARS.map((x, index) => (
          <span
            key={x}
            className={styles.bar}
            style={{ left: `${((x - 1.3) / 24) * 100}%`, animationDelay: `${index * -0.17}s` }}
          />
        ))}
      </span>
    </span>
  );
}
