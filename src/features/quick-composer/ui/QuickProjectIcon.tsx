import { useState } from "react";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { projectKey, projectName } from "../../../shared/lib/paths";
import { projectLogoSrc } from "../../projects/model/projectLogos";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLogos,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";

export function loadQuickProjectAppearance() {
  return {
    logos: loadTabGroupLogos(),
    mascots: loadTabGroupMascots(),
    colors: loadTabGroupColors(),
    customColors: loadTabGroupCustomColors(),
  };
}

/** Project paths identify appearance settings; only saved logo files are images. */
export function QuickProjectIcon({
  projectPath,
  appearance,
  className,
}: {
  projectPath: string;
  appearance: ReturnType<typeof loadQuickProjectAppearance>;
  className?: string;
}) {
  const key = projectKey(projectPath);
  const seed = projectName(projectPath);
  const logoPath = resolveTabGroupLogo(key, appearance.logos);
  const src = projectLogoSrc(logoPath);
  // A failure is remembered against the src and appearance it happened for, so
  // reopening (which reloads appearance) retries a logo that may have been replaced.
  const [failure, setFailure] = useState<{
    src: string | null;
    appearance: typeof appearance;
  } | null>(null);
  const failed = failure?.src === src && failure.appearance === appearance;

  if (src && !failed)
    return (
      <img
        src={src}
        alt=""
        {...surfaceAttributes({ radius: "sm" }, `object-cover ${className ?? ""}`)}
        onError={() => setFailure({ src, appearance })}
      />
    );
  return (
    <ProjectMascot
      project={seed}
      name={resolveTabGroupMascot(key, appearance.mascots)}
      color={resolveTabGroupColor(key, appearance.colors, appearance.customColors, seed)}
      className={className}
    />
  );
}
