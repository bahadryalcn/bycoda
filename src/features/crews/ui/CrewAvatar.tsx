import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { Avatar, type AvatarSize } from "../../../shared/ui/identity/Avatar";
import { crewColor, useCrewAppearances, type CrewAppearance } from "../model/crewAppearance";
import { resolveCrewLook } from "../model/crewLook";

/** A crew's pixel icon in the look stored with the crew on the host, else this device's. */
export function CrewAvatar({
  crew,
  size = "xs",
  className,
  active = false,
  look,
}: {
  crew: { id: string; appearance?: CrewAppearance };
  /** Avatar box on the shared scale: 16 (`xs`, default), 20, 24 or 32px. */
  size?: AvatarSize;
  /** Placement only (margin, flex). */
  className?: string;
  active?: boolean;
  /** An unsaved crew's look, before it is stored. */
  look?: CrewAppearance;
}) {
  const appearance = resolveCrewLook(crew, useCrewAppearances(), look);
  return (
    <Avatar size={size} shape="control" tone="none" className={className}>
      <ProjectMascot
        project={crew.id}
        name={appearance?.icon}
        color={crewColor(appearance)}
        className="size-full"
        active={active}
      />
    </Avatar>
  );
}
