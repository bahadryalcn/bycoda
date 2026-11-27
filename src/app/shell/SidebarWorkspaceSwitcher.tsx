import type { ComponentProps, ReactNode } from "react";
import { SidebarWorktreeSwitcher } from "../../features/source-control/ui/SidebarWorktreeSwitcher";
import { useSessionProjectAppearance } from "./useSessionProjectAppearance";

/** The working-copy switcher titled with the project's rail identity (icon and name). */
export function SidebarWorkspaceSwitcher({
  leading,
  ...props
}: Omit<ComponentProps<typeof SidebarWorktreeSwitcher>, "projectLabel" | "projectIcon"> & {
  leading?: ReactNode;
}) {
  const project = useSessionProjectAppearance(props.cwd);
  const picker = (
    <SidebarWorktreeSwitcher {...props} projectLabel={project.name} projectIcon={project.icon} />
  );
  if (!leading) return picker;
  return (
    <div className="flex min-w-0 items-center">
      {leading}
      {picker}
    </div>
  );
}
