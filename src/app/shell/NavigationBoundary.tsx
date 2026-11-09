import { Button } from "../../shared/ui/Button";
import { useLocale, useT } from "../../shared/i18n";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { IS_MAC } from "../../platform/tauri/platform";
import { LoadingText } from "../../shared/ui/LoadingText";
import { PaneHeader } from "../../shared/ui/PaneHeader";
import { WindowControls } from "./WindowControls";
import { RecoveryBoundary } from "../../shared/ui/RecoveryBoundary";

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
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 10_000);
    return () => window.clearTimeout(timer);
  }, []);
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
      <LoadingText layout="fill">
        {slow
          ? t("{p0} is taking longer to load. You can return to the workspace.", { p0: name })
          : t("Loading {p0}…", { p0: name })}
      </LoadingText>
    </div>
  );
}
