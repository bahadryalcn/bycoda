import type { ReactNode } from "react";
import { useT } from "../../shared/i18n";
import { TabList, Tabs } from "../../shared/ui/Tabs";

/**
 * The Sidebar's Workspace view tabs: shared `Tabs` roving focus (focus only; Enter or Space
 * picks), while the caller's `Tab`s keep their own drag-reorder and context menu.
 */
export function WorkspaceTabList({
  value,
  className,
  children,
}: {
  value: string;
  className: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <Tabs value={value} onValueChange={() => {}} activation="manual" panels="none">
      <TabList label={t("Workspace")} data-usage-guide="sidebar-tabs" className={className}>
        {children}
      </TabList>
    </Tabs>
  );
}
