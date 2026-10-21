import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { crewColor, useCrewAppearances } from "../model/crewAppearance";

/** A crew's pixel icon in the color chosen for it on this device. */
export function CrewAvatar({
  crew,
  className = "size-3.5",
  active = false,
}: {
  crew: { id: string };
  className?: string;
  active?: boolean;
}) {
  const appearance = useCrewAppearances()[crew.id];
  return (
    <ProjectMascot
      project={crew.id}
      name={appearance?.icon}
      color={crewColor(appearance)}
      className={className}
      active={active}
    />
  );
}
