import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { surfaceAttributes } from "../Surface";
import { Text, type TextSize } from "../Text";
import styles from "./Avatar.module.css";

/** Avatar box on the doubled icon scale: 16, 20, 24 and 32px. */
export type AvatarSize = "xs" | "sm" | "md" | "lg";

const TEXT_SIZE: Record<AvatarSize, TextSize> = {
  xs: "micro",
  sm: "micro",
  md: "caption",
  lg: "secondary",
};

export type AvatarProps = Omit<ComponentPropsWithoutRef<"span">, "children" | "className"> & {
  /** 16 / 20 / 24 / 32 px. Default `md`. */
  size?: AvatarSize;
  /** `circle` for a person or assistant, `control` (radius 8) for a crew or provider mark. */
  shape?: "circle" | "control";
  /** Picture URL; a failed load falls back to `fallback`. */
  src?: string | null;
  /** Shown without a picture: an initial (set in the avatar type size) or a glyph. */
  fallback?: ReactNode;
  /**
   * Ground behind the fallback: `accent` the solid accent, `neutral` a quiet fill (default), `none`
   * no ground (art that draws its own, such as a pixel mascot).
   */
  tone?: "accent" | "neutral" | "none";
  /** A status mark on the lower inline-end corner (a presence dot). */
  badge?: ReactNode;
  /** Replaces the picture and fallback entirely; fill the box (`size-full`). */
  children?: ReactNode;
  /** Placement only (margin, flex); the size is `size`. */
  className?: string;
};

/**
 * Decorative identity picture: the photo, else the fallback on a tone ground, else nothing. The
 * enclosing control or the name next to it carries the accessible name.
 * @group identity
 * @use One person, assistant, crew or account picture at a fixed size on the icon scale.
 * @avoid A product or provider logo: HarnessIcon. A status dot alone: StatusDot. Free-size boxes: use `size`.
 * @example
 * <Avatar size="md" src={user.avatarUrl} fallback={initial} tone="accent" />
 * <Avatar size="xs" shape="control" tone="none">{mascot}</Avatar>
 */
export function Avatar({
  size = "md",
  shape = "circle",
  src,
  fallback,
  tone = "neutral",
  badge,
  children,
  className,
  ...props
}: AvatarProps) {
  const [broken, setBroken] = useState<string | null>(null);
  const photo = src && broken !== src ? src : null;
  const showsGround = !children && !photo;
  return (
    <span
      {...props}
      {...surfaceAttributes(
        {
          radius: shape === "circle" ? "circle" : "control",
          variant: showsGround && tone === "neutral" ? "inset" : undefined,
          tone: showsGround && tone === "accent" ? "accent" : undefined,
          toneFill: showsGround && tone === "accent" ? "solid" : undefined,
        },
        [styles.avatar, className].filter(Boolean).join(" "),
      )}
      data-size={size}
      aria-hidden="true"
    >
      <span
        {...surfaceAttributes({ radius: shape === "circle" ? "circle" : "control" }, styles.face)}
      >
        {children ? (
          children
        ) : photo ? (
          <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setBroken(photo)} />
        ) : typeof fallback === "string" ? (
          <Text
            as="span"
            size={TEXT_SIZE[size]}
            tone={tone === "accent" ? "accent-on-solid" : "secondary"}
            weight="medium"
            leading="none"
          >
            {fallback}
          </Text>
        ) : (
          fallback
        )}
      </span>
      {badge ? (
        <span {...surfaceAttributes({ variant: "card", radius: "circle" }, styles.badge)}>
          {badge}
        </span>
      ) : null}
    </span>
  );
}
