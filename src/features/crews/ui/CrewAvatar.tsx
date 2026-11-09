import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { crewColor, useCrewAppearances, type CrewAppearance } from "../model/crewAppearance";

/** A crew's pixel icon in the color chosen for it on this device. */
export function CrewAvatar({
  crew,
  className = "icon-sm",
  active = false,
  look,
}: {
  crew: { id: string };
  className?: string;
  active?: boolean;
  /** An unsaved crew's look, before it is stored for this device. */
  look?: CrewAppearance;
}) {
  const saved = useCrewAppearances()[crew.id];
  const appearance = look ?? saved;
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
