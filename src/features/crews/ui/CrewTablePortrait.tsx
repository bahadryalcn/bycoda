import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useMemo, useSyncExternalStore, type CSSProperties } from "react";
import { t } from "../../../shared/i18n";
import type { CrewTheme } from "../../settings";
import { loadCrewTheme, subscribeCrewTheme } from "../../settings/public/settings";
import type { CrewAgent } from "../model/crew";
import { crewTableRects } from "../model/crewTableArt";
import {
  seatCrewTable,
  TABLE_SCENE,
  type CrewTableSeat,
  type CrewTableState,
} from "../model/crewTableLayout";
import { DEFAULT_MEMBER_AVATARS } from "../model/memberAvatarDefaults";
import { resolveTeamAvatars } from "../model/memberAvatarTraits";
import { MemberAvatar } from "./MemberAvatar";

const SCENE_STYLE: CSSProperties = { width: TABLE_SCENE.width, height: TABLE_SCENE.height };
const SIGN_STYLE: CSSProperties = { left: TABLE_SCENE.width - 36, top: 8 };
const seatStyle = (seat: CrewTableSeat): CSSProperties => ({
  left: seat.x,
  top: seat.y,
});

/**
 * A crew seated at a table: up to six member busts behind a small pixel table whose props
 * show the crew's state (idle glasses, working board, a raised hand for a decision, an
 * overturned glass when blocked). `activeIds` members blink. The portrait is one image named
 * by the crew, member count and state; the busts and props are decorative. The text that
 * names a decision or blocker stays with the caller.
 * @group display
 * @use A wide crew header on a team card.
 * @avoid A small crew mark in rows and rails: CrewFaces.
 */
export function CrewTablePortrait({
  name,
  members,
  state = "idle",
  stateLabel,
  activeIds,
  theme,
  className,
}: {
  name: string;
  members: readonly CrewAgent[];
  state?: CrewTableState;
  /** Visible state wording, repeated in the image name for assistive technology. */
  stateLabel?: string;
  activeIds?: ReadonlySet<string>;
  /** Scene theme; defaults to the owner's crew theme setting. */
  theme?: CrewTheme;
  className?: string;
}) {
  const setting = useSyncExternalStore(subscribeCrewTheme, loadCrewTheme, loadCrewTheme);
  const sceneTheme = theme ?? setting;
  const { seats, hidden } = useMemo(() => seatCrewTable(members), [members]);
  const traits = useMemo(() => resolveTeamAvatars(members, DEFAULT_MEMBER_AVATARS), [members]);
  const rects = useMemo(() => crewTableRects(sceneTheme, state, seats), [sceneTheme, state, seats]);
  const label = [name, t("{p0} members", { p0: members.length }), stateLabel]
    .filter(Boolean)
    .join(", ");
  return (
    <div
      role="img"
      aria-label={label}
      className={[
        "flex h-24 w-full items-end justify-center overflow-hidden rounded-md bg-(--ui-surface-raised)",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div aria-hidden className="relative shrink-0" style={SCENE_STYLE}>
        {/* Back row first: later siblings paint over earlier ones, so no z-index is needed. */}
        {[...seats]
          .sort((a, b) => a.z - b.z)
          .map((seat) => {
            const seatTraits = traits.get(seat.id);
            if (!seatTraits) return null;
            return (
              <span key={seat.id} className="absolute block" style={seatStyle(seat)}>
                <MemberAvatar
                  traits={seatTraits}
                  size={seat.size}
                  active={activeIds?.has(seat.id)}
                  className="block"
                />
              </span>
            );
          })}
        <svg
          viewBox={`0 0 ${TABLE_SCENE.width} ${TABLE_SCENE.height}`}
          width={TABLE_SCENE.width}
          height={TABLE_SCENE.height}
          shapeRendering="crispEdges"
          className="absolute inset-0"
        >
          {rects.map((rect, i) => (
            <rect key={i} x={rect[0]} y={rect[1]} width={rect[2]} height={rect[3]} fill={rect[4]} />
          ))}
        </svg>
        {hidden > 0 ? (
          <Text
            tone="muted"
            weight="medium"
            {...surfaceAttributes({ radius: "sm" }, "absolute bg-(--ui-surface-panel) px-1")}
            style={SIGN_STYLE}
          >
            {`+${hidden}`}
          </Text>
        ) : null}
      </div>
    </div>
  );
}
