import { Skeleton, SkeletonBar } from "./Skeleton";
import { surfaceAttributes } from "./Surface";
import styles from "./SkeletonList.module.css";

export type SkeletonListProps = {
  /** Total row count, spread evenly over `groups`. Default 4. */
  rows?: number;
  /** Number of groups the rows split into; each group gets its own heading and frame. Default 1. */
  groups?: number;
  /** A short heading bar above each group (a section title or a navigation group label). */
  heading?: boolean;
  /** Draw each group as a card with hairlines between rows, like a settings topic. */
  framed?: boolean;
  /** Shape before the text: a 16px icon slot or a round avatar. Default none. */
  leading?: "none" | "icon" | "avatar";
  /** Text lines per row: a title, or a title with a description below it. Default 2. */
  lines?: 1 | 2;
  /**
   * Shape after the text. `control` mixes switches, selects and buttons the way a settings
   * column does; `switch`, `text` (a short value) and `badge` repeat one shape. Default none.
   */
  trailing?: "none" | "control" | "switch" | "text" | "badge";
  /** Row height: `compact` for menus and navigation, `comfortable` for settings rows. */
  density?: "compact" | "default" | "comfortable";
  /** Varies the generated widths; give neighbouring lists different seeds. Default 0. */
  seed?: number;
  /**
   * Busy status for this region. With a label the list announces itself once and waits out the
   * shared loading delay; without one it is a decorative part of a larger loading surface.
   */
  label?: string;
  className?: string;
};

/** Stable pseudo-random integer in [min, max] for a slot, so widths look natural yet never jump. */
export function skeletonSpread(seed: number, slot: number, min: number, max: number) {
  let hash = Math.imul((seed + 1) * 0x9e37 + slot * 0x85eb + 0x27d4, 0x2c1b3c6d) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x297a2d39) >>> 0;
  hash = (hash ^ (hash >>> 13)) >>> 0;
  return min + (hash % (max - min + 1));
}

const CONTROLS = [
  { shape: "pill", width: "2.25rem", height: "1.25rem" },
  { shape: "bar", width: "8.5rem", height: "var(--ui-control-height-compact)" },
  { shape: "bar", width: "5.5rem", height: "var(--ui-control-height-compact)" },
] as const;

function Trailing({
  kind,
  seed,
  slot,
}: {
  kind: SkeletonListProps["trailing"];
  seed: number;
  slot: number;
}) {
  if (!kind || kind === "none") return null;
  if (kind === "text")
    return <SkeletonBar width={`${skeletonSpread(seed, slot, 3, 5)}rem`} height="0.625rem" />;
  if (kind === "badge")
    return (
      <SkeletonBar
        shape="pill"
        width={`${skeletonSpread(seed, slot, 3, 4)}rem`}
        height="1.125rem"
      />
    );
  const control =
    kind === "switch" ? CONTROLS[0] : CONTROLS[skeletonSpread(seed, slot, 0, CONTROLS.length - 1)]!;
  return <SkeletonBar shape={control.shape} width={control.width} height={control.height} />;
}

function Leading({ kind }: { kind: SkeletonListProps["leading"] }) {
  if (kind === "icon") return <SkeletonBar shape="square" height="var(--ui-icon-md)" />;
  if (kind === "avatar")
    return (
      <SkeletonBar
        shape="pill"
        width="var(--ui-control-height)"
        height="var(--ui-control-height)"
      />
    );
  return null;
}

/**
 * Generated placeholder for any list-shaped content: navigation, pickers, settings topics,
 * account or file lists. Props describe the row anatomy (leading shape, text lines, trailing
 * control, density) and grouping; widths vary per row from a stable seed so the skeleton reads
 * like real labels without inventing values, and the shared shimmer sweeps it as one surface.
 * @group feedback
 * @use First load of a list, picker, navigation rail or settings page whose row anatomy is known.
 * @avoid Free text or one block: Skeleton. A bespoke shape: SkeletonBar. Unknown layout: LoadingText or SurfaceLoading.
 */
export function SkeletonList({
  rows = 4,
  groups = 1,
  heading = false,
  framed = false,
  leading = "none",
  lines = 2,
  trailing = "none",
  density = "default",
  seed = 0,
  label,
  className,
}: SkeletonListProps) {
  const total = Math.max(1, Math.round(rows));
  const groupCount = Math.min(total, Math.max(1, Math.round(groups)));
  const sizes = Array.from(
    { length: groupCount },
    (_, group) => Math.floor(total / groupCount) + (group < total % groupCount ? 1 : 0),
  );
  const shapes = (
    <div
      className={[styles.list, label ? undefined : className].filter(Boolean).join(" ")}
      data-density={density}
      aria-hidden="true"
    >
      {sizes.map((size, group) => (
        <div className={styles.group} key={group}>
          {heading ? (
            <SkeletonBar
              width={`${skeletonSpread(seed, 1000 + group, density === "compact" ? 3 : 6, density === "compact" ? 5 : 10)}rem`}
              height={density === "compact" ? "0.5rem" : "0.75rem"}
              className={styles.heading}
            />
          ) : null}
          <div
            {...(framed
              ? surfaceAttributes({ variant: "card", frame: "card", radius: "card" }, styles.rows)
              : { className: styles.rows })}
            data-framed={framed || undefined}
          >
            {Array.from({ length: size }, (_, offset) => {
              const at = sizes.slice(0, group).reduce((sum, count) => sum + count, offset);
              return (
                <div
                  {...(framed
                    ? surfaceAttributes({ separator: "block" }, styles.row)
                    : { className: styles.row })}
                  key={at}
                >
                  <Leading kind={leading} />
                  <div className={styles.text}>
                    <SkeletonBar
                      width={`${skeletonSpread(seed, at, lines === 1 ? 45 : 28, lines === 1 ? 80 : 52)}%`}
                      height={density === "compact" ? "0.625rem" : "0.75rem"}
                    />
                    {lines === 2 ? (
                      <SkeletonBar
                        width={`${skeletonSpread(seed, at + 500, 46, 78)}%`}
                        height="0.5rem"
                      />
                    ) : null}
                  </div>
                  <Trailing kind={trailing} seed={seed} slot={at} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
  if (!label) return shapes;
  return <Skeleton label={label} className={className} placeholder={shapes} />;
}
