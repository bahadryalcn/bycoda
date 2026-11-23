import { t } from "../../../../shared/i18n";
import { Select } from "../../../../shared/ui/Select";
import { SOCIAL_PLATFORMS, SOCIAL_PLATFORM_NAMES, type SocialPlatform } from "../../model/social";
import { PlatformIcon } from "../common/PlatformIcon";

export type ProviderChoice = SocialPlatform | "email";

export type ProviderSelectProps = {
  value: ProviderChoice;
  onChange(value: ProviderChoice): void;
};

/**
 * The first field of every add-account dialog: a social platform, or "Email" for a sending email
 * account. One select instead of a kind switch above the form.
 */
export function ProviderSelect({ value, onChange }: ProviderSelectProps) {
  return (
    <Select
      label={t("Platform")}
      value={value}
      options={[
        ...SOCIAL_PLATFORMS.map((item) => ({
          value: item,
          label: SOCIAL_PLATFORM_NAMES[item],
          icon: <PlatformIcon platform={item} />,
        })),
        { value: "email", label: t("Email") },
      ]}
      onValueChange={(next) => onChange(next as ProviderChoice)}
    />
  );
}
