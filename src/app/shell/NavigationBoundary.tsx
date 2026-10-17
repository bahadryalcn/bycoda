import { Button } from "../../shared/ui/Button";
import { t, useLocale } from "../../shared/i18n";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { LoaderCircle } from "../../shared/ui/icons";
import { IS_MAC } from "../../platform/tauri/platform";
import { WindowControls } from "./WindowControls";

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
    <Suspense fallback={<NavigationLoading name={name} onBack={onBack} />}>{children}</Suspense>
  );
}

function NavigationLoading({ name, onBack }: { name: string; onBack: () => void }) {
  useLocale();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 10_000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col text-content">
      <div
        className="flex h-10 shrink-0 items-center gap-3 border-b border-stroke px-3"
        data-tauri-drag-region="deep"
      >
        {IS_MAC ? <div className="w-[78px] shrink-0" /> : null}
        <Button variant="ghost" motion="none" type="button" onClick={onBack} className="">
          {t("Back to workspace")}
        </Button>
        <span className="flex-1 text-[13px]">{name}</span>
        {IS_MAC ? null : <WindowControls />}
      </div>
      <div
        role="status"
        className="flex flex-1 items-center justify-center gap-2 text-[13px] text-content/50"
      >
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        {slow
          ? t("{p0} is taking longer to load. You can return to the workspace.", { p0: name })
          : t("Loading {p0}…", { p0: name })}
      </div>
    </div>
  );
}
