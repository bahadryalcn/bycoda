import { surfaceAttributes } from "../../../../shared/ui/Surface";
import {
  Facebook02Icon,
  InstagramIcon,
  Linkedin02Icon,
  Mail01Icon,
  NewTwitterIcon,
  RedditIcon,
  SnapchatIcon,
  TelegramIcon,
  TiktokIcon,
  WhatsappIcon,
  YoutubeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { t } from "../../../../shared/i18n";
import { Tooltip } from "../../../../shared/ui/Tooltip";
import { Text } from "../../../../shared/ui/Text";
import { SOCIAL_PLATFORM_NAMES, type SocialPlatform } from "../../model/social";
import "./common.css";

/** A social platform, or the email channel that outreach and the inbox share with them. */
export type SocialChannel = SocialPlatform | "email";

const GLYPHS: Record<SocialChannel, IconSvgElement> = {
  x: NewTwitterIcon,
  instagram: InstagramIcon,
  facebook: Facebook02Icon,
  linkedin: Linkedin02Icon,
  youtube: YoutubeIcon,
  tiktok: TiktokIcon,
  snapchat: SnapchatIcon,
  whatsapp: WhatsappIcon,
  telegram: TelegramIcon,
  reddit: RedditIcon,
  email: Mail01Icon,
};

/** Display name of a platform, or "Email" for the email channel. */
export function channelName(channel: SocialChannel): string {
  return channel === "email" ? t("Email") : SOCIAL_PLATFORM_NAMES[channel];
}

/**
 * Monochrome platform mark. It follows `currentColor`, so it reads in every theme and never
 * brings a brand color into the workbench. Decorative unless `label` is given.
 */
export function PlatformIcon({
  platform,
  className = "icon-sm",
  label,
}: {
  platform: SocialChannel;
  /** Icon scale utility (`icon-xs|sm|md|lg`); default `icon-sm`. */
  className?: string;
  label?: string;
}) {
  return (
    <HugeiconsIcon
      icon={GLYPHS[platform]}
      strokeWidth={1.75}
      className={["social-platform-icon", className].join(" ")}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

export type PlatformMarkSize = "xs" | "sm" | "md" | "lg";

/**
 * The platform mark in a small neutral tile: 16, 20, 24 or 32px. With `tooltip`, the platform
 * name is the tooltip and the accessible name, for icon-only places such as table cells.
 */
export function PlatformMark({
  platform,
  size = "sm",
  tooltip = false,
}: {
  platform: SocialChannel;
  size?: PlatformMarkSize;
  tooltip?: boolean;
}) {
  const name = channelName(platform);
  const mark = (
    <span
      {...surfaceAttributes(
        { radius: size === "xs" ? "field" : "control", variant: "fill-subtle" },
        "social-platform-mark",
      )}
      data-size={size}
      role="img"
      aria-label={name}
    >
      <Text size="inherit" tone="primary" className="inline-grid place-items-center">
        <PlatformIcon platform={platform} className="social-platform-mark-glyph" />
      </Text>
    </span>
  );
  return tooltip ? (
    <Tooltip label={name} asChild>
      {mark}
    </Tooltip>
  ) : (
    mark
  );
}

/** Several platform marks in one row, each with its name as a tooltip. */
export function PlatformMarks({
  platforms,
  size = "xs",
}: {
  platforms: SocialChannel[];
  size?: PlatformMarkSize;
}) {
  return (
    <span className="social-platform-marks">
      {[...new Set(platforms)].map((platform) => (
        <PlatformMark key={platform} platform={platform} size={size} tooltip />
      ))}
    </span>
  );
}
