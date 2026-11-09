import { useState } from "react";
import { useLocale } from "../../../shared/i18n";
import { projectKey } from "../../../shared/lib/paths";
import { projectDisplayName } from "../../projects/public/projectNames";
import { ProjectLogoIcon } from "../../projects/public/ProjectLogoIcon";
import { ProjectMascot } from "../../projects/public/ProjectMascot";
import { useTabGroupLogos } from "../../projects/public/useTabGroupLogos";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../workspace/public/tabGroups";

/** The icon the project rail shows: custom logo, else the project mascot. */
export function ProjectScopeIcon({ path }: { path: string }) {
  useLocale();
  const logos = useTabGroupLogos();
  const [colors] = useState(loadTabGroupColors);
  const [customColors] = useState(loadTabGroupCustomColors);
  const [mascots] = useState(loadTabGroupMascots);
  const key = projectKey(path);
  const name = projectDisplayName(path);
  const logoPath = resolveTabGroupLogo(key, logos);
  if (logoPath) {
    return (
      <ProjectLogoIcon path={logoPath} className="icon-md rounded-sm" imageClassName="size-4" />
    );
  }
  return (
    <ProjectMascot
      project={name}
      color={resolveTabGroupColor(key, colors, customColors, name)}
      name={resolveTabGroupMascot(key, mascots)}
      className="size-3.5"
    />
  );
}
