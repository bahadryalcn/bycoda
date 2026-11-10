import { useMemo, useSyncExternalStore } from "react";
import type { CrewTheme } from "../../settings";
import { loadCrewTheme, subscribeCrewTheme } from "../../settings/public/settings";
import { isAvatarEye, memberAvatarRects } from "../model/memberAvatarArt";
import type { MemberAvatarTraits } from "../model/memberAvatarTraits";

const BLINK_CSS = `
@keyframes member-avatar-blink { 0%, 94%, 100% { transform: scaleY(1); } 97% { transform: scaleY(0.2); } }
.member-avatar-eye { transform-box: fill-box; transform-origin: center; animation: member-avatar-blink 4.6s infinite; }
@media (prefers-reduced-motion: reduce) { .member-avatar-eye { animation: none; } }`;

/**
 * Member portrait: a pixel bust drawn from `traits` as crisp SVG rects, so it stays sharp
 * from 16 px up. It follows the device's scene theme (uncle, droid, Ent, Agent) unless `theme`
 * is given. `active` makes the eyes blink every few seconds (off under
 * reduced motion). With `label` it is an image; without it the avatar is decorative.
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
      {active ? <style>{BLINK_CSS}</style> : null}
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
