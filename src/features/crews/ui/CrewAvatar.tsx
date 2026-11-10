import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { crewColor, useCrewAppearances, type CrewAppearance } from "../model/crewAppearance";
import { resolveCrewLook } from "../model/crewLook";

/** A crew's pixel icon in the look stored with the crew on the host, else this device's. */
export function CrewAvatar({
  crew,
  className = "icon-sm",
  active = false,
  look,
}: {
  crew: { id: string; appearance?: CrewAppearance };
  className?: string;
  active?: boolean;
  /** An unsaved crew's look, before it is stored. */
  look?: CrewAppearance;
}) {
  const appearance = resolveCrewLook(crew, useCrewAppearances(), look);
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
