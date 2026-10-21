import { Folder, type IconComponent } from "../../../shared/ui/icons";
import { useEffect, useState } from "react";
import { projectLogoSrc } from "../model/projectLogos";
import { t, useLocale } from "../../../shared/i18n";
import {
  TAB_GROUP_LOGOS_CHANGED,
  tabGroupLogoDisplayRevision,
} from "../../workspace/model/tabGroups";

type Props = {
  path?: string | null;
  className?: string;
  imageClassName?: string;
  fallback?: IconComponent;
  fallbackStrokeWidth?: number;
};

export function ProjectLogoIcon({
  path,
  className = "size-3.5 shrink-0",
  imageClassName,
  fallback: Fallback = Folder,
  fallbackStrokeWidth = 1.5,
}: Props) {
  useLocale();
  const [revision, setRevision] = useState(tabGroupLogoDisplayRevision);
  const [failedImage, setFailedImage] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setRevision(tabGroupLogoDisplayRevision());
    window.addEventListener(TAB_GROUP_LOGOS_CHANGED, refresh);
    return () => window.removeEventListener(TAB_GROUP_LOGOS_CHANGED, refresh);
  }, []);

  const src = projectLogoSrc(path);
  const imageKey = `${path ?? ""}:${revision}`;
  if (src && failedImage !== imageKey) {
    return (
      <img
        key={imageKey}
        src={src}
        alt=""
        onError={() => setFailedImage(imageKey)}
        className={`rounded-sm object-cover ${className} ${imageClassName ?? ""}`}
      />
    );
  }
  if (src)
    return (
      <span
        role="img"
        aria-label={t("Project logo could not be loaded")}
        title={t("Project logo could not be loaded")}
      >
        <Fallback className={className} strokeWidth={fallbackStrokeWidth} />
      </span>
    );
  return <Fallback className={className} strokeWidth={fallbackStrokeWidth} />;
}
