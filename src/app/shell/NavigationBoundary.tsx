import { Button } from "../../shared/ui/Button";
import { useLocale, useT } from "../../shared/i18n";
import { Suspense, type ReactNode } from "react";
import { IS_MAC } from "../../platform/tauri/platform";
import { PaneHeader } from "../../shared/ui/PaneHeader";
import { WindowControls } from "./WindowControls";
import { RecoveryBoundary } from "../../shared/ui/RecoveryBoundary";
import { LoadingCard } from "../../shared/ui/LoadingCard";
import { SkeletonBar } from "../../shared/ui/Skeleton";

/** A pending page must not hide the workspace's navigation and session tree. */
export function NavigationBoundary({
  name,
  onBack,
  children,
}: {
  name: string;
  onBack: () => void;
  children: ReactNode;
}) {
  useLocale();
  return (
    <RecoveryBoundary key={name} onBack={onBack}>
      <Suspense fallback={<NavigationLoading name={name} onBack={onBack} />}>{children}</Suspense>
    </RecoveryBoundary>
  );
}

function NavigationLoading({ name, onBack }: { name: string; onBack: () => void }) {
  const t = useT();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col text-content">
      <PaneHeader
        dragRegion
        chromeInset
        leading={
          <Button variant="ghost" motion="none" type="button" onClick={onBack}>
            {t("Back to workspace")}
          </Button>
        }
        title={name}
        titleAs="div"
        trailing={IS_MAC ? null : <WindowControls />}
      />
      <LoadingCard
        title={t("Loading {p0}…", { p0: name })}
        slowDescription={t("{p0} is taking longer to load. You can return to the workspace.", {
          p0: name,
        })}
        slowAction={
          <Button size="sm" variant="secondary" type="button" onClick={onBack}>
            {t("Back to workspace")}
          </Button>
        }
      >
        {/* Neutral page shapes: a heading line, then a few content lines. */}
        <SkeletonBar width="45%" height="0.875rem" />
        {["92%", "78%", "86%", "64%"].map((width, index) => (
          <SkeletonBar key={width} width={width} height="0.625rem" index={index + 1} />
        ))}
      </LoadingCard>
    </div>
  );
}
