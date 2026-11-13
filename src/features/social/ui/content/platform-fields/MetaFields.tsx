import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { Text } from "../../../../../shared/ui/Text";
import { t } from "../../../../../shared/i18n";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { NativeSelect } from "../../../../../shared/ui/Select";
import { SOCIAL_PLATFORM_NAMES } from "../../../model/social";
import type { PlatformFieldProps } from "./PlatformFields";

/** Instagram and Facebook: feed or Reel for Facebook; carousel rules come from the attachment. */
export function MetaFields({ account, value, disabled, onChange }: PlatformFieldProps) {
  const name = SOCIAL_PLATFORM_NAMES[account.platform];
  if (account.platform !== "facebook")
    return (
      <Text as="p" size="caption" tone="muted" leading="inherit" className="content-platform-note">
        {t("Attach either one video or up to four images.")}
      </Text>
    );
  const target = value.facebook?.target ?? "feed";
  return (
    <FieldGroup
      legend={t("{p0} destination", { p0: name })}
      {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "content-platform")}
      disabled={disabled}
    >
      <NativeSelect
        aria-label={t("{p0} destination", { p0: name })}
        value={target}
        onChange={(event) =>
          onChange({
            ...value,
            facebook: {
              target: event.target.value === "reel" ? "reel" : "feed",
              frameRate: value.facebook?.frameRate,
            },
          })
        }
      >
        <option value="feed">{t("Page post")}</option>
        <option value="reel">{t("Reel")}</option>
      </NativeSelect>
    </FieldGroup>
  );
}
