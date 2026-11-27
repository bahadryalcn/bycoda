import { useMemo, useSyncExternalStore } from "react";
import type { CrewTheme } from "../../settings";
import { loadCrewTheme, subscribeCrewTheme } from "../../settings/public/settings";
import { isAvatarEye, memberAvatarRects } from "../model/memberAvatarArt";
import type { MemberAvatarTraits } from "../model/memberAvatarTraits";
import "./MemberAvatar.css";

/**
 * Member portrait: a pixel bust drawn from `traits` as crisp SVG rects, so it stays sharp
 * from 16 px up. It follows the device's scene theme (uncle, droid, Ent, Agent) unless `theme`
 * is given. `active` marks the eyes for a slow blink, which stops with decorative motion off,
 * an unfocused window, or reduced motion (see `MemberAvatar.css`). With `label` it is an image;
 * without it the avatar is decorative.
 */
export function MemberAvatar({
  traits,
  size = 24,
  active = false,
  label,
  className,
  theme,
}: {
  traits: MemberAvatarTraits;
  size?: number;
  active?: boolean;
  label?: string;
  className?: string;
  /** Overrides the device theme, for previews and tests. */
  theme?: CrewTheme;
}) {
  const deviceTheme = useSyncExternalStore(subscribeCrewTheme, loadCrewTheme, loadCrewTheme);
  const shown = theme ?? deviceTheme;
  const rects = useMemo(() => memberAvatarRects(traits, { theme: shown }), [traits, shown]);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {rects.map((rect, i) => (
        <rect
          key={i}
          x={rect[0]}
          y={rect[1]}
          width={rect[2]}
          height={rect[3]}
          fill={rect[4]}
          className={active && isAvatarEye(rect) ? "member-avatar-eye" : undefined}
        />
      ))}
    </svg>
  );
}
