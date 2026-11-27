import { Text } from "../../shared/ui/Text";
import { Heading } from "../../shared/ui/Heading";
import { Button } from "../../shared/ui/Button";
import { useLocale, useT } from "../../shared/i18n";
import { Suspense, type ReactNode } from "react";
import { IS_MAC } from "../../platform/tauri/platform";
import { PaneHeader } from "../../shared/ui/PaneHeader";
import { WindowControls } from "./WindowControls";
import { RecoveryBoundary } from "../../shared/ui/RecoveryBoundary";
import { SurfaceLoading } from "../../shared/ui/SurfaceLoading";
import { SkeletonBar } from "../../shared/ui/Skeleton";

type NavigationName =
  | "Search"
  | "Settings"
  | "Assistant"
  | "Conversation tools"
  | "Terminal"
  | "Crews"
  | "Live streaming"
  | "Servers"
  | "Inbox"
  | "Notes"
  | "Social Media"
  | "Tasks"
  | "Automations";

/** A pending page must not hide the workspace's navigation and session tree. */
export function NavigationBoundary({
  name,
  onBack,
  children,
}: {
  name: NavigationName;
  onBack: () => void;
  children: ReactNode;
}) {
  useLocale();
  const t = useT();
  const labels: Record<NavigationName, string> = {
    Search: t("Search"),
    Settings: t("Settings"),
    Assistant: t("Assistant"),
    "Conversation tools": t("Conversation tools"),
    Terminal: t("Terminal"),
    Crews: t("Crews"),
    "Live streaming": t("Live streaming"),
    Servers: t("Servers"),
    Inbox: t("Inbox"),
    Notes: t("Notes"),
    "Social Media": t("Social Media"),
    Tasks: t("Tasks"),
    Automations: t("Automations"),
  };
  const label = labels[name];
  // The one h1 of a routed screen: the route's name. Visible titles inside are h2 and below.
  return (
    <>
      <Heading as="h1" size="heading" className="sr-only">
        {label}
      </Heading>
      <RecoveryBoundary key={name} onBack={onBack}>
        <Suspense fallback={<NavigationLoading label={label} onBack={onBack} />}>
          {children}
        </Suspense>
      </RecoveryBoundary>
    </>
  );
}

function NavigationLoading({ label, onBack }: { label: string; onBack: () => void }) {
  const t = useT();
  return (
    <Text as="div" size="inherit" tone="primary" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PaneHeader
        dragRegion
        chromeInset
        leading={
          <Button variant="ghost" motion="none" type="button" onClick={onBack}>
            {t("Back to workspace")}
          </Button>
        }
        title={label}
        titleAs="div"
        trailing={IS_MAC ? null : <WindowControls />}
      />
      <SurfaceLoading
        title={t("Loading…")}
        slowDescription={t("{p0} is taking longer to load. You can return to the workspace.", {
          p0: label,
        })}
      >
        {/* Neutral page shapes: a heading line, then a few content lines. */}
        <SkeletonBar width="45%" height="0.875rem" />
        {["92%", "78%", "86%", "64%"].map((width) => (
          <SkeletonBar key={width} width={width} height="0.625rem" />
        ))}
      </SurfaceLoading>
    </Text>
  );
}
