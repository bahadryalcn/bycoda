import { Tooltip } from "../../../shared/ui/Tooltip";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Folder, type IconComponent } from "../../../shared/ui/icons";
import { useEffect, useState } from "react";
import { projectLogoSrcAt } from "../model/projectLogos";
import { useT } from "../../../shared/i18n";
import { identityClassName, type IdentitySize } from "../../../shared/ui/identity/identitySize";
import {
  TAB_GROUP_LOGOS_CHANGED,
  tabGroupLogoDisplayRevision,
} from "../../workspace/model/tabGroups";

type Props = {
  path?: string | null;
  /** Shared icon scale (icon-xs/sm/md/lg); `className` then only adds. */
  size?: IdentitySize;
  className?: string;
  imageClassName?: string;
  fallback?: IconComponent;
  fallbackStrokeWidth?: number;
};

export function ProjectLogoIcon({
  path,
  size,
  className: classNameProp,
  imageClassName,
  fallback: Fallback = Folder,
  fallbackStrokeWidth = 1.5,
}: Props) {
  const t = useT();
  const className = identityClassName(size, classNameProp, "size-3.5 shrink-0");
  const [revision, setRevision] = useState(tabGroupLogoDisplayRevision);
  const [failedImage, setFailedImage] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setRevision(tabGroupLogoDisplayRevision());
    window.addEventListener(TAB_GROUP_LOGOS_CHANGED, refresh);
    return () => window.removeEventListener(TAB_GROUP_LOGOS_CHANGED, refresh);
  }, []);

  const src = projectLogoSrcAt(path, revision);
  const imageKey = `${path ?? ""}:${revision}`;
  if (src && failedImage !== imageKey) {
    return (
      <img
        key={imageKey}
        src={src}
        alt=""
        onError={() => setFailedImage(imageKey)}
        {...surfaceAttributes(
          { radius: "sm" },
          `object-cover ${className} ${imageClassName ?? ""}`,
        )}
      />
    );
  }
  if (src)
    return (
      <Tooltip label={t("Project logo could not be loaded")} asChild>
        <span role="img" aria-label={t("Project logo could not be loaded")}>
          <Fallback className={className} strokeWidth={fallbackStrokeWidth} />
        </span>
      </Tooltip>
    );
  return <Fallback className={className} strokeWidth={fallbackStrokeWidth} />;
}
