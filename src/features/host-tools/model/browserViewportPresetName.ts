import { t } from "../../../shared/i18n/technical";
import type { BROWSER_VIEWPORT_PRESETS } from "../../../shared/lib/browserViewport";

type Preset = (typeof BROWSER_VIEWPORT_PRESETS)[number];

/** Device-class names are translated; resolution names (1K, Full HD, 4K) read the same everywhere. */
export const browserViewportPresetName = ({ id, label }: Pick<Preset, "id" | "label">) =>
  id === "desktop"
    ? t("Desktop")
    : id === "tablet"
      ? t("Tablet")
      : id === "phone"
        ? t("Phone")
        : label;
