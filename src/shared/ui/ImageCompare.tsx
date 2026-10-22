import {
  ImageCompare as ArcImageCompare,
  type ImageCompareProps,
} from "./arc/image-compare/image-compare";
import { t, useLocale } from "../i18n";

export function ImageCompare(props: ImageCompareProps) {
  useLocale();
  return (
    <ArcImageCompare
      label={t("Compare images")}
      labels={[t("Before"), t("After")]}
      {...props}
      className={["bycoda-arc bycoda-arc-image-compare", props.className].filter(Boolean).join(" ")}
    />
  );
}
