import styles from "./WorkingIndicator.module.css";

/** Decorative working signal. The enclosing status owns its accessible label. */
export function WorkingIndicator({
  className = "inline-block w-3.5 shrink-0",
}: {
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={`${styles.indicator} ${className}`}>
      <svg viewBox="0 0 24 24" fill="currentColor" focusable="false">
        {[4.5, 9.5, 14.5, 19.5].map((x, index) => (
          <rect
            key={x}
            x={x - 1.3}
            y={5}
            width={2.6}
            height={14}
            rx={1.3}
            style={{ animationDelay: `${index * -0.17}s`, transformOrigin: `${x}px 12px` }}
          />
        ))}
      </svg>
    </span>
  );
}
