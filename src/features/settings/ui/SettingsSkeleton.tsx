import type { ReactNode } from "react";
import { Heading } from "../../../shared/ui/Heading";
import { SkeletonBar } from "../../../shared/ui/Skeleton";
import { SkeletonList, skeletonSpread } from "../../../shared/ui/SkeletonList";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import "./SettingsLoadingSurface.css";

/**
 * Decorative copy of Settings topics for in-page loading: a heading above a framed group of
 * rows (title, description, a mix of switches and selects), so the loaded page replaces it in
 * place. `rows` is the total row count spread over the groups.
 */
export function SettingsGroupsSkeleton({ rows = 6, seed = 0 }: { rows?: number; seed?: number }) {
  return (
    <SkeletonList
      rows={rows}
      groups={rows <= 3 ? 1 : 2}
      heading
      framed
      lines={2}
      trailing="control"
      density="comfortable"
      seed={seed}
    />
  );
}

/**
 * Copy of the whole Settings workbench while its code loads: the category rail on the left, the
 * page title row with an optional `status` line, then framed topics in the content column. Same
 * widths as the loaded view. Without a `title` the title row is a shape too, so the composing
 * surface (a labelled Skeleton) owns the one busy status; only a given title and status reach
 * assistive technology.
 */
export function SettingsShellSkeleton({
  title,
  status,
  seed = 0,
}: {
  title?: ReactNode;
  status?: ReactNode;
  seed?: number;
}) {
  return (
    <div className="settings-skeleton-shell">
      <div
        {...surfaceAttributes(
          { variant: "workspace-panel", frame: "pane", edge: "inline-end" },
          "settings-skeleton-rail",
        )}
        aria-hidden="true"
      >
        <div className="settings-skeleton-account">
          <SkeletonBar shape="pill" width="1.75rem" height="1.75rem" />
          <div className="settings-skeleton-account-text">
            <SkeletonBar width="70%" height="0.625rem" />
            <SkeletonBar width="50%" height="0.5rem" />
          </div>
        </div>
        <SkeletonList
          rows={14}
          groups={3}
          heading
          leading="icon"
          lines={1}
          density="compact"
          seed={seed + 7}
        />
      </div>
      <div className="settings-skeleton-content">
        <div className="settings-skeleton-title">
          {title === undefined ? (
            <span aria-hidden="true">
              <SkeletonBar width={`${skeletonSpread(seed, 2000, 8, 12)}rem`} height="1.125rem" />
            </span>
          ) : (
            <Heading size="page" truncate>
              {title}
            </Heading>
          )}
          <SkeletonBar shape="square" height="var(--ui-control-height-compact)" />
        </div>
        {status ? <div className="settings-skeleton-status">{status}</div> : null}
        <div aria-hidden="true">
          <SettingsGroupsSkeleton rows={7} seed={seed} />
        </div>
      </div>
    </div>
  );
}
