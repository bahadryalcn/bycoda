import { useResolvedTabGroupLogo } from "../../workspace/public/tabGroups";
import { ProjectLogoIcon } from "./ProjectLogoIcon";
import { ProjectMascot } from "./ProjectMascot";

// Project rows include detailed SVG mascots, so bound their DOM sooner than ordinary pickers.
export const PROJECT_WINDOW_THRESHOLD = 24;

/** Resolve the project's shipped logo only while its picker row is mounted. */
export function ProjectOptionIcon({
  project,
  seed,
  logos,
  mascot,
  color,
  logoClassName = "icon-sm",
  mascotClassName = "icon-sm",
}: {
  project: string;
  seed: string;
  logos: Record<string, string>;
  mascot: string | null;
  color: string;
  logoClassName?: string;
  mascotClassName?: string;
}) {
  const logo = useResolvedTabGroupLogo(project, logos);
  return logo ? (
    <ProjectLogoIcon path={logo} className={logoClassName} />
  ) : (
    <ProjectMascot project={seed} name={mascot} color={color} className={mascotClassName} />
  );
}
