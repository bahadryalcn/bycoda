import { SkeletonBar } from "../../../shared/ui/Skeleton";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import "./SettingsLoadingSurface.css";

// Fixed, varied widths so the placeholder reads like real labels without inventing values.
const TITLE_WIDTHS = ["34%", "46%", "28%", "40%", "52%", "38%"];
const DESCRIPTION_WIDTHS = ["58%", "72%", "50%", "64%", "44%", "68%"];
const CONTROL_WIDTHS = ["2.5rem", "9rem", "6rem", "9rem", "2.5rem", "7rem"];

/**
 * Decorative copy of Settings rows: title and description on the left, a control (toggle or
 * select) on the right, hairlines between rows. `start` offsets widths and the pulse wave.
 */
export function SettingsRowsSkeleton({ rows = 4, start = 0 }: { rows?: number; start?: number }) {
  return (
    <div className="settings-skeleton-rows" aria-hidden="true">
      {Array.from({ length: Math.max(1, Math.round(rows)) }, (_, offset) => {
        const at = start + offset;
        const control = CONTROL_WIDTHS[at % CONTROL_WIDTHS.length]!;
        const toggle = control === "2.5rem";
        return (
          <div {...surfaceAttributes({ separator: "block" }, "settings-skeleton-row")} key={at}>
            <div className="settings-skeleton-label">
              <SkeletonBar width={TITLE_WIDTHS[at % TITLE_WIDTHS.length]} index={at} />
              <SkeletonBar
                width={DESCRIPTION_WIDTHS[at % DESCRIPTION_WIDTHS.length]}
                height="0.5rem"
                index={at}
              />
            </div>
            <SkeletonBar
              shape={toggle ? "pill" : "bar"}
              width={control}
              height={toggle ? "1.25rem" : "var(--ui-control-height-compact)"}
              index={at}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Decorative copy of Settings topics for in-page loading: a heading above a framed group of rows,
 * so the loaded page replaces it in place. `rows` is the total row count spread over the groups.
 */
export function SettingsGroupsSkeleton({ rows = 6 }: { rows?: number }) {
  const total = Math.max(1, Math.round(rows));
  const sizes = total <= 3 ? [total] : [Math.ceil(total / 2), Math.floor(total / 2)];
  return (
    <div className="settings-skeleton-groups" aria-hidden="true">
      {sizes.map((size, group) => (
        <div className="settings-skeleton-group" key={group}>
          <SkeletonBar width={group === 0 ? "9rem" : "7rem"} index={group * sizes[0]!} />
          <div
            {...surfaceAttributes(
              { variant: "card", frame: "card", radius: "card" },
              "settings-skeleton-frame",
            )}
          >
            <SettingsRowsSkeleton rows={size} start={group * sizes[0]!} />
          </div>
        </div>
      ))}
    </div>
  );
}
